import { isWorkingSet } from '../../common/constants/training';
import { epley1RM } from '../../common/utils/one-rep-max.util';
import type { FieldViolation } from '../../common/utils/validation-errors.util';
import type { WorkoutBodyDto } from './dto/workout.dto';
import type { Workout, WorkoutExercise, WorkoutSet } from './schemas/workout.schema';

/** Tolerated client clock drift for timestamps "in the future". */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

export type WorkoutBody = Pick<
  Workout,
  | 'name'
  | 'routineId'
  | 'programId'
  | 'startedAt'
  | 'finishedAt'
  | 'durationSeconds'
  | 'notes'
  | 'rating'
  | 'exercises'
  | 'volumeKg'
  | 'workingSets'
>;

const round = (value: number, decimals = 2) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Volume counts completed WORKING sets only (SPEC: warmups never count). Weightless sets add 0. */
export function setVolume(
  set: Pick<WorkoutSet, 'type' | 'completed' | 'weightKg' | 'reps'>,
): number {
  if (!set.completed || !isWorkingSet(set.type)) return 0;
  return (set.weightKg ?? 0) * (set.reps ?? 0);
}

/** DTO → stored body with every server-computed field (volumes, duration, totals). */
export function buildWorkoutBody(dto: WorkoutBodyDto): WorkoutBody {
  const exercises: WorkoutExercise[] = dto.exercises.map((exercise) => {
    const sets: WorkoutSet[] = exercise.sets.map((set) => ({
      id: set.id,
      type: set.type,
      weightKg: set.weightKg ?? null,
      reps: set.reps ?? null,
      completed: set.completed ?? false,
      completedAt: set.completedAt ?? null,
    }));
    return {
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      routineExerciseId: exercise.routineExerciseId ?? null,
      groupId: exercise.groupId ?? null,
      notes: exercise.notes ?? '',
      sets,
      volumeKg: round(sets.reduce((sum, set) => sum + setVolume(set), 0)),
    };
  });

  const finishedAt = dto.finishedAt ?? null;
  return {
    name: dto.name ?? '',
    routineId: dto.routineId ?? null,
    programId: dto.programId ?? null,
    startedAt: dto.startedAt,
    finishedAt,
    durationSeconds: finishedAt
      ? Math.round((finishedAt.getTime() - dto.startedAt.getTime()) / 1000)
      : null,
    notes: dto.notes ?? '',
    rating: dto.rating ?? null,
    exercises,
    volumeKg: round(exercises.reduce((sum, e) => sum + e.volumeKg, 0)),
    workingSets: exercises.reduce(
      (count, e) => count + e.sets.filter((s) => s.completed && isWorkingSet(s.type)).length,
      0,
    ),
  };
}

/** Cross-field rules: time order, no future sessions, completed sets need reps, unique ids. */
export function workoutViolations(body: WorkoutBody, now: Date): FieldViolation[] {
  const violations: FieldViolation[] = [];
  const latest = now.getTime() + FUTURE_TOLERANCE_MS;

  if (body.startedAt.getTime() > latest)
    violations.push({ field: 'startedAt', constraints: ['notInFuture'] });
  if (body.finishedAt) {
    if (body.finishedAt < body.startedAt)
      violations.push({ field: 'finishedAt', constraints: ['afterStartedAt'] });
    if (body.finishedAt.getTime() > latest)
      violations.push({ field: 'finishedAt', constraints: ['notInFuture'] });
  }

  const slotIds = new Set<string>();
  const setIds = new Set<string>();
  body.exercises.forEach((exercise, i) => {
    if (slotIds.has(exercise.id))
      violations.push({ field: `exercises.${i}.id`, constraints: ['unique'] });
    slotIds.add(exercise.id);
    exercise.sets.forEach((set, j) => {
      const at = `exercises.${i}.sets.${j}`;
      if (setIds.has(set.id)) violations.push({ field: `${at}.id`, constraints: ['unique'] });
      setIds.add(set.id);
      if (set.completed && set.reps === null)
        violations.push({ field: `${at}.reps`, constraints: ['requiredWhenCompleted'] });
    });
  });
  return violations;
}

export interface Performance {
  workoutId: string;
  startedAt: Date;
  sets: WorkoutSet[];
  volumeKg: number;
  bestE1RM: number | null;
}

/** One exercise within one workout; several slots of the same exercise are merged in order. */
export function performanceOf(
  workout: Pick<Workout, '_id' | 'startedAt' | 'exercises'>,
  exerciseId: string,
): Performance | null {
  const sets = workout.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
  if (!sets.length) return null;
  let best: number | null = null;
  for (const set of sets) {
    if (!set.completed || !isWorkingSet(set.type) || set.reps === null) continue;
    const e1rm = epley1RM(set.weightKg, set.reps);
    if (e1rm !== null && (best === null || e1rm > best)) best = e1rm;
  }
  return {
    workoutId: workout._id,
    startedAt: workout.startedAt,
    sets,
    volumeKg: round(sets.reduce((sum, set) => sum + setVolume(set), 0)),
    bestE1RM: best === null ? null : round(best, 1),
  };
}
