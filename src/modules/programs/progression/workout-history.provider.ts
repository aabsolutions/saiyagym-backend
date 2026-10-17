import { Injectable } from '@nestjs/common';
import type { SetType } from '../../../common/constants/training';

export interface PerformedSet {
  type: SetType;
  weightKg: number | null;
  reps: number;
  completed: boolean;
}

/** One past session of one exercise. */
export interface ExercisePerformance {
  performedAt: Date;
  sets: PerformedSet[];
}

/**
 * Port: where progression reads training history from. Programs don't know about the
 * workouts collection; the workouts module will provide the real adapter by binding
 * this token. Until then, the empty adapter makes every exercise start from its
 * prescription (`NO_HISTORY`).
 */
export abstract class WorkoutHistoryProvider {
  /** Most recent first, at most `limit` sessions, excluding deleted workouts. */
  abstract recentPerformances(
    userId: string,
    exerciseIds: string[],
    limit: number,
  ): Promise<Map<string, ExercisePerformance[]>>;
}

@Injectable()
export class EmptyWorkoutHistoryProvider extends WorkoutHistoryProvider {
  recentPerformances(): Promise<Map<string, ExercisePerformance[]>> {
    return Promise.resolve(new Map<string, ExercisePerformance[]>());
  }
}
