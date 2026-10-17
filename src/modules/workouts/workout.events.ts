/**
 * Internal domain events (@nestjs/event-emitter). Emitted after the write commits, from REST and
 * sync alike. Only FINISHED workouts affect stats/PRs, so in-progress edits emit nothing.
 * Listeners (PR detection, stats — B6) must be idempotent: the same workout can be re-emitted.
 */
export const WorkoutEvents = {
  /** finishedAt went from null to a date. */
  FINISHED: 'workout.finished',
  /** A finished workout was edited (or reopened). */
  UPDATED: 'workout.updated',
  /** A finished workout was deleted. */
  DELETED: 'workout.deleted',
} as const;

export type WorkoutEventName = (typeof WorkoutEvents)[keyof typeof WorkoutEvents];

export class WorkoutChangedEvent {
  constructor(
    readonly userId: string,
    readonly workoutId: string,
    /** Union of exercises before and after the change (what stats must recompute). */
    readonly exerciseIds: string[],
    readonly source: 'rest' | 'sync',
    readonly occurredAt = new Date(),
  ) {}
}

/** A record broken by a workout. */
export interface BrokenRecord {
  exerciseId: string;
  type: 'maxWeight' | 'bestE1RM' | 'maxVolume' | 'repsAtWeight';
  value: number;
  previous: number;
  weightKg: number;
  reps: number;
}

/**
 * What a listener may return to `emitAsync`: records the workout broke. Workouts collects these to
 * answer `newRecords` in the same response without importing the records module.
 */
export interface WorkoutRecordsResult {
  workoutId: string;
  newRecords: BrokenRecord[];
}

export function isWorkoutRecordsResult(value: unknown): value is WorkoutRecordsResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as WorkoutRecordsResult).newRecords)
  );
}

interface WorkoutState {
  finishedAt: Date | null;
  deletedAt: Date | null;
  exercises: { exerciseId: string }[];
}

/** Which event (if any) a transition produces. Pure, unit-tested. */
export function workoutEventFor(
  before: WorkoutState | null,
  after: WorkoutState,
): WorkoutEventName | null {
  const wasFinished = Boolean(before && !before.deletedAt && before.finishedAt);
  const isFinished = Boolean(!after.deletedAt && after.finishedAt);

  if (after.deletedAt) return wasFinished ? WorkoutEvents.DELETED : null;
  if (isFinished && !wasFinished) return WorkoutEvents.FINISHED;
  if (wasFinished) return WorkoutEvents.UPDATED; // edited, or reopened (isFinished false)
  return null;
}
