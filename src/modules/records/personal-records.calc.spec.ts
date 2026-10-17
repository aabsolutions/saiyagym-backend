import {
  computeRecords,
  newRecordsFor,
  type RecordSession,
  type RecordSet,
} from './personal-records.calc';

const s = (
  weightKg: number | null,
  reps: number | null,
  type: RecordSet['type'] = 'normal',
  completed = true,
): RecordSet => ({
  type,
  weightKg,
  reps,
  completed,
});
const session = (workoutId: string, day: number, sets: RecordSet[]): RecordSession => ({
  workoutId,
  startedAt: new Date(Date.UTC(2024, 0, day)),
  sets,
});
const without = (sessions: RecordSession[], id: string) =>
  sessions.filter((x) => x.workoutId !== id);

describe('computeRecords', () => {
  it('computes every record type, ignoring warmups and unfinished sets', () => {
    const records = computeRecords([
      session('w1', 1, [
        s(140, 3, 'warmup'),
        s(100, 5),
        s(100, 5),
        s(80, 10),
        s(150, 1, 'normal', false),
      ]),
    ]);
    expect(records.maxWeight).toMatchObject({ value: 100, reps: 5, workoutId: 'w1' });
    expect(records.bestE1RM).toMatchObject({ value: 116.7, weightKg: 100, reps: 5 }); // 100×(1+5/30)
    expect(records.maxVolume).toMatchObject({ value: 100 * 5 * 2 + 80 * 10 });
    expect(records.repsAtWeight.map((r) => [r.weightKg, r.value])).toEqual([
      [80, 10],
      [100, 5],
    ]);
  });

  it('counts dropsets and failure sets (working sets)', () => {
    const records = computeRecords([
      session('w1', 1, [s(60, 20, 'failure'), s(50, 15, 'dropset')]),
    ]);
    expect(records.maxWeight?.value).toBe(60);
    expect(records.maxVolume?.value).toBe(60 * 20 + 50 * 15);
  });

  it('e1RM only uses 1–12 reps; a heavier e1RM from a 15-rep set is ignored', () => {
    const records = computeRecords([session('w1', 1, [s(100, 15), s(90, 3)])]);
    expect(records.bestE1RM).toMatchObject({ value: 99, weightKg: 90, reps: 3 }); // 90×1.1
    expect(records.maxWeight?.value).toBe(100); // max weight still counts any reps
  });

  it('a tie keeps the earliest holder', () => {
    const records = computeRecords([
      session('later', 5, [s(100, 5)]),
      session('first', 1, [s(100, 5)]),
    ]);
    expect(records.maxWeight?.workoutId).toBe('first');
  });

  it('ignores bodyweight / unloaded sets and returns empty records without data', () => {
    expect(computeRecords([session('w1', 1, [s(null, 12), s(0, 10)])])).toEqual({
      maxWeight: null,
      bestE1RM: null,
      maxVolume: null,
      repsAtWeight: [],
    });
  });
});

describe('newRecordsFor (detection & recalculation)', () => {
  const history = [
    session('w1', 1, [s(100, 5), s(100, 5)]),
    session('w2', 8, [s(100, 6), s(90, 8)]),
  ];

  it('the first session of an exercise is the baseline, not a record', () => {
    const first = [session('w0', 1, [s(100, 5)])];
    expect(newRecordsFor(computeRecords([]), computeRecords(first), 'w0')).toEqual([]);
  });

  it('detects every record the workout broke, with the previous value', () => {
    const all = [...history, session('w3', 15, [s(105, 5), s(100, 7), s(90, 8)])];
    const found = newRecordsFor(computeRecords(without(all, 'w3')), computeRecords(all), 'w3');
    expect(found).toEqual([
      { type: 'maxWeight', value: 105, previous: 100, weightKg: 105, reps: 5 },
      // 100×7 → 123.3 beats 105×5 → 122.5; previous best was 100×6 → 120
      { type: 'bestE1RM', value: 123.3, previous: 120, weightKg: 100, reps: 7 },
      { type: 'maxVolume', value: 105 * 5 + 700 + 720, previous: 1320, weightKg: 0, reps: 0 },
      { type: 'repsAtWeight', value: 7, previous: 6, weightKg: 100, reps: 7 },
    ]);
  });

  it('matching a record is not breaking it; a first-time weight is not a rep PR', () => {
    const all = [...history, session('w3', 15, [s(100, 6), s(95, 3)])];
    expect(newRecordsFor(computeRecords(without(all, 'w3')), computeRecords(all), 'w3')).toEqual(
      [],
    );
  });

  it('editing the record-holding session compares against the runner-up, not itself', () => {
    // w2 holds max weight (100×6 ties w1's 100 but e1RM 120 > 116.7). Edit w2 up to 102.5×6.
    const edited = [history[0]!, session('w2', 8, [s(102.5, 6), s(90, 8)])];
    const found = newRecordsFor(
      computeRecords(without(edited, 'w2')),
      computeRecords(edited),
      'w2',
    );
    expect(found.find((r) => r.type === 'maxWeight')).toMatchObject({
      value: 102.5,
      previous: 100,
    });
    expect(found.find((r) => r.type === 'bestE1RM')).toMatchObject({ value: 123, previous: 116.7 });
  });

  it('recalculation after deleting the holder falls back to the runner-up', () => {
    const before = computeRecords(history);
    expect(before.bestE1RM).toMatchObject({ value: 120, workoutId: 'w2' });
    const afterDelete = computeRecords(without(history, 'w2'));
    expect(afterDelete.bestE1RM).toMatchObject({ value: 116.7, workoutId: 'w1' });
    expect(afterDelete.repsAtWeight.map((r) => r.weightKg)).toEqual([100]); // 90 kg only existed in w2
  });

  it('editing a set down lowers the record to what the data supports', () => {
    const lowered = [history[0]!, session('w2', 8, [s(95, 6)])];
    expect(computeRecords(lowered).maxWeight).toMatchObject({ value: 100, workoutId: 'w1' });
  });
});
