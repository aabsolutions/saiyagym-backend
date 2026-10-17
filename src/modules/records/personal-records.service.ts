import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { ExercisesService } from '../exercises/exercises.service';
import { Workout } from '../workouts/schemas/workout.schema';
import {
  WorkoutChangedEvent,
  WorkoutEvents,
  type BrokenRecord,
  type WorkoutRecordsResult,
} from '../workouts/workout.events';
import {
  computeRecords,
  newRecordsFor,
  type ExerciseRecords,
  type RecordSession,
} from './personal-records.calc';
import { ExerciseRecordsDto, RecordsSummaryItemDto } from './dto/records.dto';
import { PersonalRecord } from './schemas/personal-record.schema';
import { scrubText } from '../../common/utils/log-redaction.util';

@Injectable()
export class PersonalRecordsService {
  private readonly logger = new Logger(PersonalRecordsService.name);

  constructor(
    @InjectModel(PersonalRecord.name) private readonly records: Model<PersonalRecord>,
    @InjectModel(Workout.name) private readonly workouts: Model<Workout>,
    private readonly exercises: ExercisesService,
  ) {}

  /**
   * Recomputes the records of every exercise the change touched (before ∪ after). Returned to
   * `emitAsync` so the workout response can include `newRecords`. Never throws: the workout is
   * already saved, and records are rebuildable — a failure is logged, not surfaced.
   */
  // One decorator per event: `@OnEvent([a, b, c])` is NOT "any of" — EventEmitter2 reads an array
  // as a single namespaced event (a.b.c), so the listener would never fire.
  @OnEvent(WorkoutEvents.FINISHED)
  @OnEvent(WorkoutEvents.UPDATED)
  @OnEvent(WorkoutEvents.DELETED)
  async onWorkoutChanged(event: WorkoutChangedEvent): Promise<WorkoutRecordsResult> {
    try {
      const newRecords = await this.recalculate(event.userId, event.exerciseIds, event.workoutId);
      return { workoutId: event.workoutId, newRecords };
    } catch (error) {
      this.logger.error(
        `Records recompute failed for workout ${event.workoutId}`,
        scrubText(error instanceof Error ? (error.stack ?? error.message) : String(error)),
      );
      return { workoutId: event.workoutId, newRecords: [] };
    }
  }

  /** From scratch over all finished, live workouts — correct after edits and deletions. */
  async recalculate(
    userId: string,
    exerciseIds: string[],
    workoutId: string,
  ): Promise<BrokenRecord[]> {
    const broken: BrokenRecord[] = [];
    for (const exerciseId of exerciseIds) {
      const sessions = await this.sessionsOf(userId, exerciseId);
      const after = computeRecords(sessions);
      const others = computeRecords(sessions.filter((s) => s.workoutId !== workoutId));
      broken.push(...newRecordsFor(others, after, workoutId).map((r) => ({ ...r, exerciseId })));
      await this.store(userId, exerciseId, after);
    }
    return broken;
  }

  // ----- queries -----

  async listForUser(userId: string, lang: string): Promise<RecordsSummaryItemDto[]> {
    const docs = await this.records
      .find(notDeleted<PersonalRecord>({ userId, maxWeight: { $ne: null } }))
      .sort({ 'maxWeight.achievedAt': -1 })
      .lean<PersonalRecord[]>();
    const names = await this.exercises.findAccessible(
      userId,
      docs.map((d) => d.exerciseId),
    );
    return docs.map((d) => ({
      exerciseId: d.exerciseId,
      name: names.has(d.exerciseId) ? localize(names.get(d.exerciseId)!.name, lang) : null,
      maxWeight: d.maxWeight,
      bestE1RM: d.bestE1RM,
      maxVolume: d.maxVolume,
    }));
  }

  async forExercise(userId: string, exerciseId: string): Promise<ExerciseRecordsDto> {
    const doc = await this.records
      .findOne(notDeleted<PersonalRecord>({ userId, exerciseId }))
      .lean<PersonalRecord>();
    return {
      exerciseId,
      maxWeight: doc?.maxWeight ?? null,
      bestE1RM: doc?.bestE1RM ?? null,
      maxVolume: doc?.maxVolume ?? null,
      repsAtWeight: doc?.repsAtWeight ?? [],
    };
  }

  // ----- internals -----

  private async sessionsOf(userId: string, exerciseId: string): Promise<RecordSession[]> {
    const workouts = await this.workouts
      .find(
        notDeleted<Workout>({
          userId,
          finishedAt: { $ne: null },
          'exercises.exerciseId': exerciseId,
        }),
        { startedAt: 1, exercises: 1 },
      )
      .lean<Workout[]>();
    return workouts.map((w) => ({
      workoutId: w._id,
      startedAt: w.startedAt,
      sets: w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets),
    }));
  }

  private async store(userId: string, exerciseId: string, records: ExerciseRecords): Promise<void> {
    await this.records.updateOne(
      { userId, exerciseId },
      { $set: { ...records, deletedAt: null } },
      { upsert: true },
    );
  }
}
