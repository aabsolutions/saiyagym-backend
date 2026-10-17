import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { notDeleted } from '../../database/base.schema';
import {
  WorkoutHistoryProvider,
  type ExercisePerformance,
} from '../programs/progression/workout-history.provider';
import { Workout } from './schemas/workout.schema';
import { performanceOf } from './workout.calc';

/** Workout-backed implementation of the programs' history port (finished, live workouts only). */
@Injectable()
export class WorkoutHistoryAdapter extends WorkoutHistoryProvider {
  constructor(@InjectModel(Workout.name) private readonly workouts: Model<Workout>) {
    super();
  }

  async recentPerformances(
    userId: string,
    exerciseIds: string[],
    limit: number,
  ): Promise<Map<string, ExercisePerformance[]>> {
    const result = new Map<string, ExercisePerformance[]>(exerciseIds.map((id) => [id, []]));
    if (!exerciseIds.length) return result;

    // Most recent sessions touching any of the exercises; enough rows to fill `limit` per exercise
    // in the common case (a routine's exercises appear together).
    const workouts = await this.workouts
      .find(
        notDeleted<Workout>({
          userId,
          finishedAt: { $ne: null },
          'exercises.exerciseId': { $in: exerciseIds },
        }),
        { startedAt: 1, exercises: 1 },
      )
      .sort({ startedAt: -1 })
      .limit(limit * exerciseIds.length)
      .lean<Workout[]>();

    for (const workout of workouts) {
      for (const exerciseId of exerciseIds) {
        const list = result.get(exerciseId)!;
        if (list.length >= limit) continue;
        const performance = performanceOf(workout, exerciseId);
        if (performance) {
          list.push({
            performedAt: performance.startedAt,
            sets: performance.sets.map((s) => ({
              type: s.type,
              weightKg: s.weightKg,
              reps: s.reps ?? 0,
              completed: s.completed,
            })),
          });
        }
      }
    }
    return result;
  }
}
