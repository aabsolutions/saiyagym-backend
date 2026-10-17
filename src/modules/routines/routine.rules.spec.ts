import type { RoutineExercise } from './schemas/routine.schema';
import { routineViolations } from './routine.rules';

const slot = (
  id: string,
  groupId: string | null = null,
  sets: Partial<RoutineExercise['sets'][number]>[] = [{}],
): RoutineExercise => ({
  id,
  exerciseId: `ex-${id}`,
  groupId,
  notes: '',
  progression: null,
  sets: sets.map((s) => ({
    type: 'normal',
    repsMin: 8,
    repsMax: 12,
    weightKg: null,
    percent1RM: null,
    restSeconds: 90,
    ...s,
  })),
});

const fields = (exercises: RoutineExercise[]) =>
  routineViolations(exercises).map((v) => `${v.field}:${v.constraints.join(',')}`);

describe('routineViolations', () => {
  it('accepts a valid routine with a contiguous superset', () => {
    expect(fields([slot('a'), slot('b', 'g1'), slot('c', 'g1'), slot('d')])).toEqual([]);
  });

  it('rejects repsMax < repsMin and weight together with %1RM', () => {
    expect(
      fields([
        slot('a', null, [
          { repsMin: 10, repsMax: 8 },
          { weightKg: 100, percent1RM: 70 },
        ]),
      ]),
    ).toEqual([
      'exercises.0.sets.0.repsMax:gteRepsMin',
      'exercises.0.sets.1.percent1RM:exclusiveWithWeightKg',
    ]);
  });

  it('rejects duplicated slot ids', () => {
    expect(fields([slot('a'), slot('a')])).toEqual(['exercises.1.id:unique']);
  });

  it('rejects non-contiguous and single-member supersets', () => {
    expect(fields([slot('a', 'g1'), slot('b'), slot('c', 'g1')])).toEqual([
      'exercises.0.groupId:contiguousSuperset',
    ]);
    expect(fields([slot('a', 'solo'), slot('b')])).toEqual([
      'exercises.0.groupId:supersetMinMembers',
    ]);
  });
});
