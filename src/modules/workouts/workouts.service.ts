import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { ExercisesService } from '../exercises/exercises.service';
import { Program } from '../programs/schemas/program.schema';
import { RoutinesService } from '../routines/routines.service';
import { SyncRegistry } from '../sync/sync.registry';
import type { StoredSyncDoc } from '../sync/sync.types';
import {
  CreateWorkoutDto,
  ExerciseHistoryPageDto,
  ExercisePerformanceDto,
  LastPerformanceDto,
  UpdateWorkoutDto,
  WorkoutBodyDto,
  WorkoutDetailDto,
  WorkoutSaveResultDto,
  WorkoutListQueryDto,
  WorkoutPageDto,
  WorkoutSummaryDto,
} from './dto/workout.dto';
import { Workout } from './schemas/workout.schema';
import {
  buildWorkoutBody,
  performanceOf,
  workoutViolations,
  type WorkoutBody,
} from './workout.calc';
import {
  isWorkoutRecordsResult,
  WorkoutChangedEvent,
  workoutEventFor,
  type BrokenRecord,
} from './workout.events';

type Filter = QueryFilter<Workout>;
type Source = 'rest' | 'sync';

@Injectable()
export class WorkoutsService implements OnModuleInit {
  constructor(
    @InjectModel(Workout.name) private readonly workouts: Model<Workout>,
    // Read-only ownership check; importing ProgramsModule would create a cycle
    // (programs read workout history through WorkoutHistoryProvider).
    @InjectModel(Program.name) private readonly programs: Model<Program>,
    private readonly exercises: ExercisesService,
    private readonly routines: RoutinesService,
    private readonly events: EventEmitter2,
    private readonly sync: SyncRegistry,
  ) {}

  onModuleInit(): void {
    this.sync.register({
      collection: 'workouts',
      model: this.workouts,
      push: {
        dto: WorkoutBodyDto,
        prepare: (ctx, payload, existing) =>
          this.prepare(ctx.userId, payload as WorkoutBodyDto, existing as Workout | null, ctx.now),
        afterWrite: async (ctx, before, after) => {
          await this.emit(ctx.userId, before, after as unknown as Workout, 'sync');
        },
      },
    });
  }

  // ===== REST =====

  /** Idempotent on the client id: a retried create returns the stored workout untouched. */
  async create(
    userId: string,
    dto: CreateWorkoutDto,
    lang: string,
  ): Promise<{ created: boolean; workout: WorkoutSaveResultDto }> {
    if (dto.id) {
      const existing = await this.workouts.findById(dto.id).lean<Workout>();
      if (existing) {
        if (existing.userId !== userId)
          throw new AppException(ErrorCode.CONFLICT, HttpStatus.CONFLICT);
        if (existing.deletedAt) throw notFound();
        // A replay doesn't re-emit events, so it reports no new records.
        return {
          created: false,
          workout: { ...(await this.toDetail(existing, userId, lang)), newRecords: [] },
        };
      }
    }

    const body = await this.prepare(userId, dto, null, new Date());
    try {
      const created = await this.workouts.create({
        ...body,
        ...(dto.id && { _id: dto.id }),
        userId,
      });
      const stored = created.toObject() as Workout;
      const newRecords = await this.emit(userId, null, stored, 'rest');
      return {
        created: true,
        workout: { ...(await this.toDetail(stored, userId, lang)), newRecords },
      };
    } catch (error) {
      // Two concurrent retries of the same create: the loser returns the winner's result.
      if ((error as { code?: unknown }).code === 11000 && dto.id)
        return this.create(userId, dto, lang);
      throw error;
    }
  }

  async detail(userId: string, id: string, lang: string): Promise<WorkoutDetailDto> {
    return this.toDetail(await this.requireOwned(userId, id), userId, lang);
  }

  async list(userId: string, query: WorkoutListQueryDto): Promise<WorkoutPageDto> {
    const filter: Filter = notDeleted<Workout>({ userId });
    if (query.from || query.to) {
      filter.startedAt = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lt: query.to }),
      };
    }
    if (query.status === 'finished') filter.finishedAt = { $ne: null };
    if (query.status === 'in_progress') filter.finishedAt = null;

    const [items, total] = await Promise.all([
      this.workouts
        .find(filter)
        .sort({ startedAt: -1, _id: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<Workout[]>(),
      this.workouts.countDocuments(filter),
    ]);
    return { items: items.map(toSummary), meta: { page: query.page, limit: query.limit, total } };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateWorkoutDto,
    lang: string,
  ): Promise<WorkoutSaveResultDto> {
    const existing = await this.requireOwned(userId, id);
    const merged: WorkoutBodyDto = {
      name: dto.name ?? existing.name,
      routineId: dto.routineId !== undefined ? dto.routineId : existing.routineId,
      programId: dto.programId !== undefined ? dto.programId : existing.programId,
      startedAt: dto.startedAt ?? existing.startedAt,
      finishedAt: dto.finishedAt !== undefined ? dto.finishedAt : existing.finishedAt,
      notes: dto.notes ?? existing.notes,
      rating: dto.rating !== undefined ? dto.rating : existing.rating,
      exercises: dto.exercises ?? existing.exercises,
    };
    const body = await this.prepare(userId, merged, existing, new Date());
    const updated = await this.workouts
      .findOneAndUpdate(
        notDeleted<Workout>({ _id: id, userId }),
        { $set: body },
        { returnDocument: 'after' },
      )
      .lean<Workout>();
    if (!updated) throw notFound();
    const newRecords = await this.emit(userId, existing, updated, 'rest');
    return { ...(await this.toDetail(updated, userId, lang)), newRecords };
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.requireOwned(userId, id);
    const deletedAt = new Date();
    await this.workouts.updateOne({ _id: id, userId }, { deletedAt });
    await this.emit(userId, existing, { ...existing, deletedAt }, 'rest');
  }

  // ===== Per-exercise history (finished workouts only) =====

  async lastPerformance(userId: string, exerciseId: string): Promise<LastPerformanceDto> {
    const [workout] = await this.workouts
      .find(finishedWith(userId, exerciseId))
      .sort({ startedAt: -1 })
      .limit(1)
      .lean<Workout[]>();
    return { lastPerformance: workout ? toPerformanceDto(workout, exerciseId) : null };
  }

  async exerciseHistory(
    userId: string,
    exerciseId: string,
    page: number,
    limit: number,
  ): Promise<ExerciseHistoryPageDto> {
    const filter = finishedWith(userId, exerciseId);
    const [items, total] = await Promise.all([
      this.workouts
        .find(filter)
        .sort({ startedAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<Workout[]>(),
      this.workouts.countDocuments(filter),
    ]);
    return {
      items: items.map((w) => toPerformanceDto(w, exerciseId)),
      meta: { page, limit, total },
    };
  }

  // ===== Shared by REST and sync =====

  /**
   * Validation + server-computed fields. References that were valid when the workout was logged
   * stay valid on later edits even if the exercise/routine/program was deleted since.
   */
  private async prepare(
    userId: string,
    dto: WorkoutBodyDto,
    existing: Workout | null,
    now: Date,
  ): Promise<WorkoutBody> {
    const body = buildWorkoutBody(dto);
    const violations = workoutViolations(body, now);
    if (violations.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
        details: violations,
      });
    }

    const alreadyReferenced = new Set(existing?.exercises.map((e) => e.exerciseId) ?? []);
    const toCheck = body.exercises
      .map((e) => e.exerciseId)
      .filter((id) => !alreadyReferenced.has(id));
    await this.exercises.assertAccessible(userId, toCheck);

    if (body.routineId && body.routineId !== existing?.routineId) {
      const owned = await this.routines.findOwned(userId, [body.routineId]);
      if (!owned.has(body.routineId))
        throw new AppException(ErrorCode.ROUTINE_NOT_FOUND, HttpStatus.BAD_REQUEST);
    }
    if (body.programId && body.programId !== existing?.programId) {
      const owned = await this.programs.exists(
        notDeleted<Program>({ _id: body.programId, userId }),
      );
      if (!owned) throw new AppException(ErrorCode.PROGRAM_NOT_FOUND, HttpStatus.BAD_REQUEST);
    }
    return body;
  }

  /**
   * `emitAsync` awaits the listeners and collects what they return, so records broken by this
   * workout come back in the same response — without workouts importing the records module.
   */
  private async emit(
    userId: string,
    before: Workout | StoredSyncDoc | null,
    after: Workout,
    source: Source,
  ): Promise<BrokenRecord[]> {
    const name = workoutEventFor(before as Workout | null, after);
    if (!name) return [];
    const exerciseIds = new Set([
      ...((before as Workout | null)?.exercises ?? []).map((e) => e.exerciseId),
      ...after.exercises.map((e) => e.exerciseId),
    ]);
    const results: unknown[] = await this.events.emitAsync(
      name,
      new WorkoutChangedEvent(userId, after._id, [...exerciseIds], source),
    );
    return results
      .filter(isWorkoutRecordsResult)
      .filter((r) => r.workoutId === after._id)
      .flatMap((r) => r.newRecords);
  }

  private async requireOwned(userId: string, id: string): Promise<Workout> {
    const workout = await this.workouts
      .findOne(notDeleted<Workout>({ _id: id, userId }))
      .lean<Workout>();
    if (!workout) throw notFound();
    return workout;
  }

  private async toDetail(
    workout: Workout,
    userId: string,
    lang: string,
  ): Promise<WorkoutDetailDto> {
    const catalog = await this.exercises.findAccessible(
      userId,
      workout.exercises.map((e) => e.exerciseId),
    );
    return {
      ...toSummary(workout),
      notes: workout.notes,
      exercises: workout.exercises.map((e) => ({
        ...e,
        name: catalog.has(e.exerciseId) ? localize(catalog.get(e.exerciseId)!.name, lang) : null,
      })),
      createdAt: workout.createdAt,
    };
  }
}

/** Finished, live workouts containing the exercise (uses the SPEC index userId + exercises.exerciseId). */
function finishedWith(userId: string, exerciseId: string): Filter {
  return notDeleted<Workout>({
    userId,
    'exercises.exerciseId': exerciseId,
    finishedAt: { $ne: null },
  });
}

function toPerformanceDto(workout: Workout, exerciseId: string): ExercisePerformanceDto {
  return performanceOf(workout, exerciseId)!;
}

function toSummary(w: Workout): WorkoutSummaryDto {
  return {
    id: w._id,
    name: w.name,
    routineId: w.routineId,
    programId: w.programId,
    startedAt: w.startedAt,
    finishedAt: w.finishedAt,
    durationSeconds: w.durationSeconds,
    rating: w.rating,
    exerciseCount: w.exercises.length,
    workingSets: w.workingSets,
    volumeKg: w.volumeKg,
    updatedAt: w.updatedAt,
  };
}

function notFound(): AppException {
  return new AppException(ErrorCode.WORKOUT_NOT_FOUND, HttpStatus.NOT_FOUND);
}
