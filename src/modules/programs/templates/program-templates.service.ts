import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../../common/constants/error-codes';
import { AppException } from '../../../common/exceptions/app.exception';
import { localize } from '../../../common/utils/translatable.util';
import type { FieldViolation } from '../../../common/utils/validation-errors.util';
import { notDeleted } from '../../../database/base.schema';
import { EntitlementsService } from '../../entitlements/entitlements.service';
import { ExercisesService } from '../../exercises/exercises.service';
import type { RoutineExerciseDto } from '../../routines/dto/routine.dto';
import { normalizeExercises, routineViolations } from '../../routines/routine.rules';
import type { RoutineExercise } from '../../routines/schemas/routine.schema';
import { RoutinesService } from '../../routines/routines.service';
import { ProgramsService } from '../programs.service';
import {
  AdminProgramTemplateDto,
  CopyProgramTemplateDto,
  CopyProgramTemplateResultDto,
  CreateProgramTemplateDto,
  ProgramTemplateDetailDto,
  ProgramTemplateSummaryDto,
  UpdateProgramTemplateDto,
} from './program-template.dto';
import { ProgramTemplate, ProgramTemplateDocument } from './program-template.schema';

type TemplateContent = Pick<ProgramTemplate, 'durationWeeks' | 'routines' | 'weeks' | 'deload'>;

const DEFAULT_DELOAD = { weeks: [], mode: 'weight' as const, percent: 40 };

@Injectable()
export class ProgramTemplatesService {
  constructor(
    @InjectModel(ProgramTemplate.name) private readonly templates: Model<ProgramTemplate>,
    private readonly exercises: ExercisesService,
    private readonly routines: RoutinesService,
    private readonly programs: ProgramsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ===== Users =====

  async list(lang: string): Promise<ProgramTemplateSummaryDto[]> {
    const templates = await this.templates
      .find(notDeleted<ProgramTemplate>({ active: true }))
      .sort({ sortOrder: 1, slug: 1 })
      .lean<ProgramTemplate[]>();
    return templates.map((t) => toSummary(t, lang));
  }

  async detail(id: string, lang: string): Promise<ProgramTemplateDetailDto> {
    const template = await this.requireActive(id);
    const catalog = await this.exercises.findGlobalBySlugs(slugsOf(template));
    return {
      ...toSummary(template, lang),
      routines: template.routines.map((r) => ({
        key: r.key,
        name: localize(r.name, lang),
        exercises: r.exercises.map((e) => {
          const exercise = catalog.get(e.exerciseSlug);
          return {
            exerciseSlug: e.exerciseSlug,
            exerciseId: exercise?._id ?? null,
            name: exercise ? localize(exercise.name, lang) : null,
            groupId: e.groupId,
            notes: e.notes,
            sets: e.sets,
            progression: e.progression,
          };
        }),
      })),
      weeks: template.weeks,
      deload: template.deload,
    };
  }

  /**
   * Copies the template into the user's own routines + a draft program.
   * Everything that can fail is checked BEFORE writing, so a failed copy never leaves
   * orphan routines eating the plan's routine slots.
   */
  async copy(
    userId: string,
    id: string,
    dto: CopyProgramTemplateDto,
    lang: string,
  ): Promise<CopyProgramTemplateResultDto> {
    const template = await this.requireActive(id);
    const trainingMaxes = dto.trainingMaxes ?? [];
    await this.exercises.assertAccessible(
      userId,
      trainingMaxes.map((tm) => tm.exerciseId),
    );
    await this.entitlements.assertWithinLimit(userId, 'routines', template.routines.length);

    const progressionEnabled = await this.entitlements.hasFeature(userId, 'autoProgression');
    const catalog = await this.exercises.findGlobalBySlugs(slugsOf(template));
    const skipped = new Set<string>();
    let rulesDropped = false;

    const newRoutines = template.routines.map((routine) => {
      const kept = routine.exercises.filter((e) => {
        if (catalog.has(e.exerciseSlug)) return true;
        skipped.add(e.exerciseSlug);
        return false;
      });
      const exercises: RoutineExercise[] = dropBrokenSupersets(
        kept.map((e) => {
          if (e.progression && !progressionEnabled) rulesDropped = true;
          return {
            id: randomUUID(),
            exerciseId: catalog.get(e.exerciseSlug)!._id,
            groupId: e.groupId,
            notes: e.notes,
            sets: e.sets.map((s) => ({ ...s })),
            progression: progressionEnabled ? e.progression : null,
          };
        }),
      );
      return { name: localize(routine.name, lang).slice(0, 80), notes: '', exercises };
    });

    const created = await this.routines.createMany(userId, newRoutines);
    const idByKey = new Map(template.routines.map((r, i) => [r.key, created[i]!._id]));

    const program = await this.programs.createFromContent(userId, {
      name: (dto.name ?? localize(template.name, lang)).slice(0, 80),
      notes: localize(template.description, lang),
      durationWeeks: template.durationWeeks,
      weeks: template.weeks.map((w) => ({
        days: w.days.map((d) => ({
          weekday: d.weekday,
          routineId: idByKey.get(d.routineKey)!,
          label: null,
        })),
      })),
      deload: {
        weeks: template.deload.weeks,
        mode: template.deload.mode,
        percent: template.deload.percent,
      },
      trainingMaxes: trainingMaxes.map((tm) => ({ exerciseId: tm.exerciseId, kg: tm.kg })),
      templateId: template._id,
    });

    return {
      program,
      routineIds: created.map((r) => r._id),
      skippedExercises: [...skipped],
      progressionRulesDropped: rulesDropped,
    };
  }

  // ===== Admin =====

  async adminList(): Promise<AdminProgramTemplateDto[]> {
    const templates = await this.templates
      .find(notDeleted<ProgramTemplate>())
      .sort({ sortOrder: 1, slug: 1 })
      .lean<ProgramTemplate[]>();
    return templates.map(toAdmin);
  }

  async adminGet(id: string): Promise<AdminProgramTemplateDto> {
    return toAdmin(await this.requireExisting(id));
  }

  async create(dto: CreateProgramTemplateDto): Promise<AdminProgramTemplateDto> {
    if (await this.templates.exists({ slug: dto.slug })) throw slugTaken();
    const content = fromDto(dto);
    await this.validate(content);
    try {
      const created = await this.templates.create({
        ...content,
        slug: dto.slug,
        name: dto.name,
        description: dto.description ?? {},
        goal: dto.goal,
        level: dto.level,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      });
      return toAdmin(created.toObject());
    } catch (error) {
      if ((error as { code?: unknown }).code === 11000) throw slugTaken();
      throw error;
    }
  }

  async update(id: string, dto: UpdateProgramTemplateDto): Promise<AdminProgramTemplateDto> {
    const template = await this.requireExistingDoc(id);
    const merged = fromDto({
      durationWeeks: dto.durationWeeks ?? template.durationWeeks,
      routines: dto.routines ?? template.routines,
      weeks: dto.weeks ?? template.weeks,
      deload: dto.deload ?? template.deload,
    });
    await this.validate(merged);
    template.set({
      ...merged,
      ...(dto.name && { name: dto.name }),
      ...(dto.description && { description: dto.description }),
      ...(dto.goal && { goal: dto.goal }),
      ...(dto.level && { level: dto.level }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
    });
    await template.save();
    return toAdmin(template.toObject());
  }

  /** Soft delete; programs already copied from it are unaffected. The slug stays reserved. */
  async remove(id: string): Promise<void> {
    await this.requireExisting(id);
    await this.templates.updateOne({ _id: id }, { deletedAt: new Date(), active: false });
  }

  /** Structural + catalog checks shared by admin CRUD and the seeder. */
  async validate(content: TemplateContent): Promise<void> {
    const violations: FieldViolation[] = [];
    if (content.weeks.length !== content.durationWeeks) {
      violations.push({ field: 'weeks', constraints: ['lengthEqualsDurationWeeks'] });
    }
    const keys = content.routines.map((r) => r.key);
    if (new Set(keys).size !== keys.length)
      violations.push({ field: 'routines', constraints: ['uniqueKeys'] });

    content.weeks.forEach((week, i) => {
      const weekdays = week.days.map((d) => d.weekday);
      if (new Set(weekdays).size !== weekdays.length) {
        violations.push({ field: `weeks.${i}.days`, constraints: ['uniqueWeekdays'] });
      }
      week.days.forEach((day, j) => {
        if (!keys.includes(day.routineKey)) {
          violations.push({
            field: `weeks.${i}.days.${j}.routineKey`,
            constraints: ['knownRoutineKey'],
          });
        }
      });
    });
    if (content.deload.weeks.some((w) => w > content.durationWeeks)) {
      violations.push({ field: 'deload.weeks', constraints: ['withinDurationWeeks'] });
    }
    content.routines.forEach((routine, i) => {
      const asRoutine = routine.exercises.map((e, j) => ({
        ...e,
        id: `slot-${j}`,
        exerciseId: e.exerciseSlug,
      }));
      for (const v of routineViolations(asRoutine)) {
        violations.push({ ...v, field: `routines.${i}.${v.field}` });
      }
    });
    if (violations.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
        details: violations,
      });
    }

    const slugs = [
      ...new Set(content.routines.flatMap((r) => r.exercises.map((e) => e.exerciseSlug))),
    ];
    const found = await this.exercises.findGlobalBySlugs(slugs);
    const missing = slugs.filter((slug) => !found.has(slug));
    if (missing.length) {
      throw new AppException(ErrorCode.EXERCISE_NOT_FOUND, HttpStatus.BAD_REQUEST, {
        details: { missing },
      });
    }
  }

  // ===== Internals =====

  private async requireActive(id: string): Promise<ProgramTemplate> {
    const template = await this.templates
      .findOne(notDeleted<ProgramTemplate>({ _id: id, active: true }))
      .lean<ProgramTemplate>();
    if (!template) throw notFound();
    return template;
  }

  private async requireExisting(id: string): Promise<ProgramTemplate> {
    const template = await this.templates
      .findOne(notDeleted<ProgramTemplate>({ _id: id }))
      .lean<ProgramTemplate>();
    if (!template) throw notFound();
    return template;
  }

  private async requireExistingDoc(id: string): Promise<ProgramTemplateDocument> {
    const template = await this.templates.findOne(notDeleted<ProgramTemplate>({ _id: id }));
    if (!template) throw notFound();
    return template;
  }
}

// ----- helpers -----

/** Template exercise as received (DTO) or as stored — the DTO shape accepts both. */
type TemplateExerciseInput = Omit<RoutineExerciseDto, 'id' | 'exerciseId'> & {
  exerciseSlug: string;
};

/** DTO (or stored) content → stored shape with defaults filled, reusing routine normalization. */
export function fromDto(dto: {
  durationWeeks: number;
  routines: { key: string; name: Record<string, string>; exercises: TemplateExerciseInput[] }[];
  weeks: { days: { weekday: number; routineKey: string }[] }[];
  deload?: { weeks: number[]; mode: 'weight' | 'sets'; percent: number } | null;
}): TemplateContent {
  return {
    durationWeeks: dto.durationWeeks,
    routines: dto.routines.map((r) => ({
      key: r.key,
      name: r.name,
      exercises: normalizeExercises(
        r.exercises.map(({ exerciseSlug, ...rest }) => ({ ...rest, exerciseId: exerciseSlug })),
      ).map((e) => ({
        exerciseSlug: e.exerciseId,
        groupId: e.groupId,
        notes: e.notes,
        sets: e.sets,
        progression: e.progression,
      })),
    })),
    weeks: dto.weeks.map((w) => ({
      days: w.days.map((d) => ({ weekday: d.weekday, routineKey: d.routineKey })),
    })),
    deload: dto.deload
      ? { weeks: dto.deload.weeks, mode: dto.deload.mode, percent: dto.deload.percent }
      : DEFAULT_DELOAD,
  };
}

/** After skipping exercises, a superset left with one member is just a normal exercise. */
function dropBrokenSupersets(exercises: RoutineExercise[]): RoutineExercise[] {
  const counts = new Map<string, number>();
  for (const e of exercises) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) ?? 0) + 1);
  return exercises.map((e) =>
    e.groupId && counts.get(e.groupId)! < 2 ? { ...e, groupId: null } : e,
  );
}

function slugsOf(template: ProgramTemplate): string[] {
  return [...new Set(template.routines.flatMap((r) => r.exercises.map((e) => e.exerciseSlug)))];
}

function toSummary(t: ProgramTemplate, lang: string): ProgramTemplateSummaryDto {
  return {
    id: t._id,
    slug: t.slug,
    name: localize(t.name, lang),
    description: localize(t.description, lang),
    goal: t.goal,
    level: t.level,
    durationWeeks: t.durationWeeks,
    daysPerWeek: Math.max(0, ...t.weeks.map((w) => w.days.length)),
    routineCount: t.routines.length,
    usesAutoProgression: t.routines.some((r) => r.exercises.some((e) => e.progression !== null)),
  };
}

function toAdmin(t: ProgramTemplate): AdminProgramTemplateDto {
  return {
    id: t._id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    goal: t.goal,
    level: t.level,
    durationWeeks: t.durationWeeks,
    routines: t.routines,
    weeks: t.weeks,
    deload: t.deload,
    active: t.active,
    sortOrder: t.sortOrder,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function notFound(): AppException {
  return new AppException(ErrorCode.PROGRAM_TEMPLATE_NOT_FOUND, HttpStatus.NOT_FOUND);
}

function slugTaken(): AppException {
  return new AppException(ErrorCode.PROGRAM_TEMPLATE_SLUG_TAKEN, HttpStatus.CONFLICT);
}
