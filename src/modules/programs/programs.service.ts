import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import type { FieldViolation } from '../../common/utils/validation-errors.util';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { UsageCountersRegistry } from '../entitlements/usage-counters.registry';
import { ExercisesService } from '../exercises/exercises.service';
import { RoutineUsageRegistry } from '../routines/routine-usage.registry';
import { RoutinesService } from '../routines/routines.service';
import { SyncRegistry } from '../sync/sync.registry';
import {
  CreateProgramDto,
  ProgramDto,
  ProgramListQueryDto,
  TodayDto,
  TodayExerciseDto,
  UpdateProgramDto,
} from './dto/program.dto';
import { isLocalDate, scheduleFor, utcToday } from './progression/program-schedule';
import { ProgressionService } from './progression/progression.service';
import { WorkoutHistoryProvider } from './progression/workout-history.provider';
import { Program, ProgramDocument } from './schemas/program.schema';

const HISTORY_SESSIONS = 5;

type Filter = QueryFilter<Program>;

/** Program content without the lifecycle fields. */
export type ProgramContent = Pick<
  Program,
  'name' | 'notes' | 'durationWeeks' | 'weeks' | 'deload' | 'trainingMaxes'
> & { templateId?: string | null };

@Injectable()
export class ProgramsService implements OnModuleInit {
  constructor(
    @InjectModel(Program.name) private readonly programs: Model<Program>,
    private readonly routines: RoutinesService,
    private readonly exercises: ExercisesService,
    private readonly entitlements: EntitlementsService,
    private readonly progression: ProgressionService,
    private readonly history: WorkoutHistoryProvider,
    private readonly counters: UsageCountersRegistry,
    private readonly routineUsage: RoutineUsageRegistry,
    private readonly sync: SyncRegistry,
  ) {}

  onModuleInit(): void {
    // Pull-only: programs are planned on the web; the app needs them offline for "today".
    this.sync.register({ collection: 'programs', model: this.programs });

    // Free: 1 active program (SPEC). Drafts and completed programs are unlimited.
    this.counters.register('activePrograms', (userId) =>
      this.programs.countDocuments(notDeleted<Program>({ userId, status: 'active' })),
    );
    // A routine scheduled in a draft/active program can't be deleted.
    this.routineUsage.register(async (userId, routineId) =>
      Boolean(
        await this.programs.exists(
          notDeleted<Program>({
            userId,
            status: { $in: ['draft', 'active'] },
            'weeks.days.routineId': routineId,
          }),
        ),
      ),
    );
  }

  // ----- queries -----

  async list(userId: string, query: ProgramListQueryDto): Promise<ProgramDto[]> {
    const filter: Filter = notDeleted<Program>({ userId });
    if (query.status) filter.status = query.status;
    const programs = await this.programs.find(filter).sort({ updatedAt: -1 }).lean<Program[]>();
    return this.toDtos(userId, programs);
  }

  async detail(userId: string, id: string): Promise<ProgramDto> {
    return (await this.toDtos(userId, [await this.requireOwned(userId, id)]))[0]!;
  }

  // ----- mutations -----

  async create(userId: string, dto: CreateProgramDto): Promise<ProgramDto> {
    const content = toContent(dto);
    await this.validate(userId, content);
    const created = await this.programs.create({ ...content, userId, status: 'draft' });
    return this.detail(userId, created._id);
  }

  /** Used by template copies: content was built server-side but is validated the same way. */
  async createFromContent(userId: string, content: ProgramContent): Promise<ProgramDto> {
    await this.validate(userId, content);
    const created = await this.programs.create({ ...content, userId, status: 'draft' });
    return this.detail(userId, created._id);
  }

  async update(userId: string, id: string, dto: UpdateProgramDto): Promise<ProgramDto> {
    const program = await this.requireOwnedDoc(userId, id);
    const structural = Object.keys(dto).some((key) => !['name', 'notes'].includes(key));
    if (program.status === 'completed' && structural) {
      throw invalidState(); // history is frozen; only renaming is allowed
    }

    const merged: ProgramContent = {
      name: dto.name ?? program.name,
      notes: dto.notes ?? program.notes,
      durationWeeks: dto.durationWeeks ?? program.durationWeeks,
      weeks: dto.weeks ? toWeeks(dto.weeks) : program.weeks,
      deload: dto.deload ?? program.deload,
      trainingMaxes: dto.trainingMaxes ?? program.trainingMaxes,
    };
    await this.validate(userId, merged);
    program.set(merged);
    await program.save();
    return this.detail(userId, id);
  }

  async activate(userId: string, id: string, startDate: string | undefined): Promise<ProgramDto> {
    const program = await this.requireOwnedDoc(userId, id);
    if (program.status === 'active') return this.detail(userId, id); // idempotent
    if (program.status !== 'draft') throw invalidState();

    const start = startDate ?? utcToday();
    if (!isLocalDate(start)) throw violation({ field: 'startDate', constraints: ['isLocalDate'] });

    // Not a @CheckLimit guard: activating an already-active program must stay idempotent,
    // and the guard can't know that before the handler runs.
    await this.entitlements.assertWithinLimit(userId, 'activePrograms');
    await this.validate(userId, program); // routines may have been deleted since it was drafted

    program.set({ status: 'active', startDate: start, activatedAt: new Date(), completedAt: null });
    await program.save();
    return this.detail(userId, id);
  }

  /** Back to draft (frees the active slot). Progress dates are reset. */
  async deactivate(userId: string, id: string): Promise<ProgramDto> {
    const program = await this.requireOwnedDoc(userId, id);
    if (program.status !== 'active') throw invalidState();
    program.set({ status: 'draft', startDate: null, activatedAt: null });
    await program.save();
    return this.detail(userId, id);
  }

  async complete(userId: string, id: string): Promise<ProgramDto> {
    const program = await this.requireOwnedDoc(userId, id);
    if (program.status !== 'active') throw invalidState();
    program.set({ status: 'completed', completedAt: new Date() });
    await program.save();
    return this.detail(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.programs.updateOne({ _id: id, userId }, { deletedAt: new Date() });
  }

  // ----- today -----

  async today(userId: string, lang: string, date?: string, programId?: string): Promise<TodayDto> {
    const day = date ?? utcToday();
    if (!isLocalDate(day)) throw violation({ field: 'date', constraints: ['isLocalDate'] });

    const filter: Filter = notDeleted<Program>({ userId, status: 'active' });
    if (programId) filter._id = programId;
    const program = await this.programs.findOne(filter).sort({ activatedAt: -1 }).lean<Program>();
    if (!program) throw new AppException(ErrorCode.NO_ACTIVE_PROGRAM, HttpStatus.NOT_FOUND);

    const schedule = scheduleFor(
      {
        startDate: program.startDate!,
        durationWeeks: program.durationWeeks,
        weeks: program.weeks,
        deloadWeeks: program.deload.weeks,
      },
      day,
    );
    const progressionEnabled = await this.entitlements.hasFeature(userId, 'autoProgression');

    const base: TodayDto = {
      programId: program._id,
      programName: program.name,
      date: day,
      status: schedule.kind,
      week: 'week' in schedule ? schedule.week : null,
      totalWeeks: program.durationWeeks,
      isDeloadWeek: 'isDeloadWeek' in schedule ? schedule.isDeloadWeek : false,
      startsInDays: schedule.kind === 'not_started' ? schedule.startsInDays : null,
      dayLabel: schedule.kind === 'training' ? schedule.day.label : null,
      routine: null,
      progressionEnabled,
    };
    if (schedule.kind !== 'training') return base;

    const routine = (await this.routines.findOwned(userId, [schedule.day.routineId])).get(
      schedule.day.routineId,
    );
    if (!routine) return base;

    const exerciseIds = routine.exercises.map((slot) => slot.exerciseId);
    const [catalog, history] = await Promise.all([
      this.exercises.findAccessible(userId, exerciseIds),
      this.history.recentPerformances(userId, exerciseIds, HISTORY_SESSIONS),
    ]);
    const maxes = new Map(program.trainingMaxes.map((tm) => [tm.exerciseId, tm.kg]));
    const deload = schedule.isDeloadWeek
      ? { mode: program.deload.mode, percent: program.deload.percent }
      : null;

    const exercises: TodayExerciseDto[] = routine.exercises.map((slot) => {
      const exercise = catalog.get(slot.exerciseId);
      const result = this.progression.compute({
        targets: slot.sets,
        rule: slot.progression,
        mechanic: exercise?.mechanic ?? 'compound',
        history: history.get(slot.exerciseId) ?? [],
        weekIndex: schedule.week - 1,
        deload,
        trainingMaxKg: maxes.get(slot.exerciseId) ?? null,
        progressionEnabled,
      });
      return {
        id: slot.id,
        exerciseId: slot.exerciseId,
        name: exercise ? localize(exercise.name, lang) : null,
        groupId: slot.groupId,
        notes: slot.notes,
        progressionType: slot.progression?.type ?? null,
        referenceMax: result.referenceMax,
        adjustments: result.notes,
        sets: result.sets,
      };
    });

    return {
      ...base,
      routine: { id: routine._id, name: routine.name, notes: routine.notes, exercises },
    };
  }

  // ----- internals -----

  /** Cross-field checks: week count, unique weekdays, deload range, ownership of routines/exercises. */
  private async validate(userId: string, content: ProgramContent): Promise<void> {
    const violations: FieldViolation[] = [];
    if (content.weeks.length !== content.durationWeeks) {
      violations.push({ field: 'weeks', constraints: ['lengthEqualsDurationWeeks'] });
    }
    content.weeks.forEach((week, i) => {
      const weekdays = week.days.map((d) => d.weekday);
      if (new Set(weekdays).size !== weekdays.length) {
        violations.push({ field: `weeks.${i}.days`, constraints: ['uniqueWeekdays'] });
      }
    });
    if (content.deload.weeks.some((w) => w > content.durationWeeks)) {
      violations.push({ field: 'deload.weeks', constraints: ['withinDurationWeeks'] });
    }
    const maxIds = content.trainingMaxes.map((tm) => tm.exerciseId);
    if (new Set(maxIds).size !== maxIds.length) {
      violations.push({ field: 'trainingMaxes', constraints: ['uniqueExercises'] });
    }
    if (violations.length) throw violation(...violations);

    const routineIds = content.weeks.flatMap((w) => w.days.map((d) => d.routineId));
    const owned = await this.routines.findOwned(userId, routineIds);
    const missing = [...new Set(routineIds)].filter((id) => !owned.has(id));
    if (missing.length) {
      throw new AppException(ErrorCode.ROUTINE_NOT_FOUND, HttpStatus.BAD_REQUEST, {
        details: { missing },
      });
    }
    await this.exercises.assertAccessible(userId, maxIds);
  }

  private async requireOwned(userId: string, id: string): Promise<Program> {
    const program = await this.programs
      .findOne(notDeleted<Program>({ _id: id, userId }))
      .lean<Program>();
    if (!program) throw notFound();
    return program;
  }

  private async requireOwnedDoc(userId: string, id: string): Promise<ProgramDocument> {
    const program = await this.programs.findOne(notDeleted<Program>({ _id: id, userId }));
    if (!program) throw notFound();
    return program;
  }

  private async toDtos(userId: string, programs: Program[]): Promise<ProgramDto[]> {
    const routineIds = programs.flatMap((p) =>
      p.weeks.flatMap((w) => w.days.map((d) => d.routineId)),
    );
    const routines = await this.routines.findOwned(userId, routineIds);
    return programs.map((p) => ({
      id: p._id,
      name: p.name,
      notes: p.notes,
      durationWeeks: p.durationWeeks,
      weeks: p.weeks.map((w) => ({
        days: w.days.map((d) => ({ ...d, routineName: routines.get(d.routineId)?.name ?? null })),
      })),
      deload: { weeks: p.deload.weeks, mode: p.deload.mode, percent: p.deload.percent },
      trainingMaxes: p.trainingMaxes.map((tm) => ({ exerciseId: tm.exerciseId, kg: tm.kg })),
      status: p.status,
      startDate: p.startDate,
      activatedAt: p.activatedAt,
      completedAt: p.completedAt,
      templateId: p.templateId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }
}

function toWeeks(weeks: CreateProgramDto['weeks']): ProgramContent['weeks'] {
  return weeks.map((w) => ({
    days: w.days.map((d) => ({
      weekday: d.weekday,
      routineId: d.routineId,
      label: d.label ?? null,
    })),
  }));
}

function toContent(dto: CreateProgramDto): ProgramContent {
  return {
    name: dto.name,
    notes: dto.notes ?? '',
    durationWeeks: dto.durationWeeks,
    weeks: toWeeks(dto.weeks),
    deload: dto.deload ?? { weeks: [], mode: 'weight', percent: 40 },
    trainingMaxes: dto.trainingMaxes ?? [],
  };
}

function violation(...details: FieldViolation[]): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, { details });
}

function notFound(): AppException {
  return new AppException(ErrorCode.PROGRAM_NOT_FOUND, HttpStatus.NOT_FOUND);
}

function invalidState(): AppException {
  return new AppException(ErrorCode.PROGRAM_INVALID_STATE, HttpStatus.CONFLICT);
}
