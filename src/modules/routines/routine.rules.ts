import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import type { FieldViolation } from '../../common/utils/validation-errors.util';
import type { RoutineExerciseDto } from './dto/routine.dto';
import type { RoutineExercise } from './schemas/routine.schema';

/** DTO → stored shape with every default filled in (slot ids generated when missing). */
export function normalizeExercises(exercises: RoutineExerciseDto[]): RoutineExercise[] {
  return exercises.map((exercise) => ({
    id: exercise.id ?? randomUUID(),
    exerciseId: exercise.exerciseId,
    groupId: exercise.groupId ?? null,
    notes: exercise.notes ?? '',
    sets: exercise.sets.map((set) => ({
      type: set.type,
      repsMin: set.repsMin,
      repsMax: set.repsMax,
      weightKg: set.weightKg ?? null,
      percent1RM: set.percent1RM ?? null,
      restSeconds: set.restSeconds ?? 120,
    })),
    progression: exercise.progression ?? null,
  }));
}

/**
 * Cross-field rules class-validator can't express on single properties:
 * rep ranges, weight vs %1RM exclusivity, unique slot ids, contiguous supersets (≥ 2 members).
 */
export function routineViolations(exercises: RoutineExercise[]): FieldViolation[] {
  const violations: FieldViolation[] = [];
  const seenIds = new Set<string>();

  exercises.forEach((exercise, i) => {
    if (seenIds.has(exercise.id))
      violations.push({ field: `exercises.${i}.id`, constraints: ['unique'] });
    seenIds.add(exercise.id);

    exercise.sets.forEach((set, j) => {
      const at = `exercises.${i}.sets.${j}`;
      if (set.repsMax < set.repsMin)
        violations.push({ field: `${at}.repsMax`, constraints: ['gteRepsMin'] });
      if (set.weightKg !== null && set.percent1RM !== null) {
        violations.push({ field: `${at}.percent1RM`, constraints: ['exclusiveWithWeightKg'] });
      }
    });
  });

  const groups = new Map<string, number[]>();
  exercises.forEach((exercise, i) => {
    if (exercise.groupId)
      groups.set(exercise.groupId, [...(groups.get(exercise.groupId) ?? []), i]);
  });
  for (const positions of groups.values()) {
    const first = positions[0]!;
    if (positions.length < 2) {
      violations.push({ field: `exercises.${first}.groupId`, constraints: ['supersetMinMembers'] });
    } else if (positions.some((position, k) => position !== first + k)) {
      violations.push({ field: `exercises.${first}.groupId`, constraints: ['contiguousSuperset'] });
    }
  }
  return violations;
}

export function assertValidRoutine(exercises: RoutineExercise[]): void {
  const violations = routineViolations(exercises);
  if (violations.length) {
    throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
      details: violations,
    });
  }
}

export const usesProgression = (exercises: RoutineExercise[]): boolean =>
  exercises.some((exercise) => exercise.progression !== null);
