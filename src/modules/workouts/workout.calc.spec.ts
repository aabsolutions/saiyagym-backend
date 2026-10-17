import type { WorkoutBodyDto } from './dto/workout.dto';
import { buildWorkoutBody, performanceOf, workoutViolations } from './workout.calc';
import { workoutEventFor } from './workout.events';

const set = (
  id: string,
  type: 'warmup' | 'normal' | 'dropset' | 'failure',
  weightKg: number | null,
  reps: number | null,
  completed = true,
) => ({
  id,
  type,
  weightKg,
  reps,
  completed,
});

const body = (overrides: Partial<WorkoutBodyDto> = {}): WorkoutBodyDto => ({
  startedAt: new Date('2024-01-01T10:00:00Z'),
  finishedAt: new Date('2024-01-01T11:05:30Z'),
  exercises: [
    {
      id: 'slot-1',
      exerciseId: 'bench',
      sets: [
        set('s1', 'warmup', 60, 10),
        set('s2', 'normal', 100, 5),
        set('s3', 'normal', 100, 4),
        set('s4', 'dropset', 70, 8),
        set('s5', 'normal', 100, 5, false), // not completed
      ],
    },
    { id: 'slot-2', exerciseId: 'dips', sets: [set('s6', 'failure', null, 12)] },
  ],
  ...overrides,
});

describe('buildWorkoutBody', () => {
  it('computes volume over completed working sets only (warmups and pending sets excluded)', () => {
    const result = buildWorkoutBody(body());
    expect(result.exercises[0]!.volumeKg).toBe(100 * 5 + 100 * 4 + 70 * 8); // 1460
    expect(result.exercises[1]!.volumeKg).toBe(0); // bodyweight: no external load
    expect(result.volumeKg).toBe(1460);
    expect(result.workingSets).toBe(4);
  });

  it('computes duration, or null while in progress', () => {
    expect(buildWorkoutBody(body()).durationSeconds).toBe(3930);
    expect(buildWorkoutBody(body({ finishedAt: null })).durationSeconds).toBeNull();
  });

  it('fills defaults', () => {
    const result = buildWorkoutBody(body());
    expect(result).toMatchObject({
      name: '',
      notes: '',
      rating: null,
      routineId: null,
      programId: null,
    });
    expect(result.exercises[0]).toMatchObject({
      groupId: null,
      routineExerciseId: null,
      notes: '',
    });
  });
});

describe('workoutViolations', () => {
  const now = new Date('2024-01-01T12:00:00Z');
  const fields = (b: WorkoutBodyDto) =>
    workoutViolations(buildWorkoutBody(b), now).map((v) => `${v.field}:${v.constraints.join(',')}`);

  it('accepts a valid workout', () => {
    expect(fields(body())).toEqual([]);
  });

  it('rejects finishing before starting and sessions in the future', () => {
    expect(fields(body({ finishedAt: new Date('2024-01-01T09:00:00Z') }))).toEqual([
      'finishedAt:afterStartedAt',
    ]);
    expect(fields(body({ startedAt: new Date('2024-01-01T13:00:00Z'), finishedAt: null }))).toEqual(
      ['startedAt:notInFuture'],
    );
  });

  it('tolerates 5 minutes of clock drift', () => {
    expect(fields(body({ startedAt: new Date('2024-01-01T12:04:00Z'), finishedAt: null }))).toEqual(
      [],
    );
  });

  it('requires reps on completed sets and unique ids', () => {
    const b = body();
    b.exercises[0]!.sets[1] = set('s2', 'normal', 100, null);
    b.exercises[1]!.sets[0]!.id = 's1';
    expect(fields(b)).toEqual([
      'exercises.0.sets.1.reps:requiredWhenCompleted',
      'exercises.1.sets.0.id:unique',
    ]);
  });
});

describe('performanceOf', () => {
  it('merges every slot of the exercise and computes the best e1RM over working sets', () => {
    const b = body();
    b.exercises.push({ id: 'slot-3', exerciseId: 'bench', sets: [set('s7', 'normal', 110, 2)] });
    const workout = { _id: 'w1', startedAt: b.startedAt, exercises: buildWorkoutBody(b).exercises };

    const perf = performanceOf(workout, 'bench')!;
    expect(perf.sets.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's7']);
    expect(perf.volumeKg).toBe(1460 + 220);
    // 110×(1+2/30)=117.3 beats 100×(1+5/30)=116.7; the 60×10 warmup (80) is ignored anyway
    expect(perf.bestE1RM).toBe(117.3);
    expect(performanceOf(workout, 'squat')).toBeNull();
  });
});

describe('workoutEventFor', () => {
  const state = (finished: boolean, deleted = false) => ({
    finishedAt: finished ? new Date() : null,
    deletedAt: deleted ? new Date() : null,
    exercises: [],
  });

  it.each([
    ['new finished workout', null, state(true), 'workout.finished'],
    ['new in-progress workout', null, state(false), null],
    ['in progress → finished', state(false), state(true), 'workout.finished'],
    ['in progress edited', state(false), state(false), null],
    ['finished edited', state(true), state(true), 'workout.updated'],
    ['finished reopened', state(true), state(false), 'workout.updated'],
    ['finished deleted', state(true), state(true, true), 'workout.deleted'],
    ['in-progress deleted', state(false), state(false, true), null],
    ['deleted restored as finished', state(true, true), state(true), 'workout.finished'],
  ])('%s', (_label, before, after, expected) => {
    expect(workoutEventFor(before, after)).toBe(expected);
  });
});
