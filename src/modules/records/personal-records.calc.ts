import { isWorkingSet, type SetType } from '../../common/constants/training';
import { epley1RM } from '../../common/utils/one-rep-max.util';

export interface RecordSet {
  type: SetType;
  weightKg: number | null;
  reps: number | null;
  completed: boolean;
}

/** One exercise in one finished workout. */
export interface RecordSession {
  workoutId: string;
  startedAt: Date;
  sets: RecordSet[];
}

/** Who holds a record and with what. */
export interface RecordEntry {
  value: number;
  weightKg: number;
  reps: number;
  workoutId: string;
  achievedAt: Date;
}

export interface ExerciseRecords {
  /** Heaviest weight lifted for ≥ 1 rep. */
  maxWeight: RecordEntry | null;
  /** Best Epley e1RM (1–12 reps only). */
  bestE1RM: RecordEntry | null;
  /** Highest single-session volume (Σ weight × reps). `weightKg`/`reps` are 0 here. */
  maxVolume: RecordEntry | null;
  /** Most reps at each exact weight, ascending by weight. `value` = reps. */
  repsAtWeight: RecordEntry[];
}

export const RECORD_TYPES = ['maxWeight', 'bestE1RM', 'maxVolume', 'repsAtWeight'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

const round = (value: number, decimals = 2) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Counts toward records: completed WORKING set with load and reps (SPEC: warmups never count). */
function qualifies(set: RecordSet): set is RecordSet & { weightKg: number; reps: number } {
  return (
    set.completed &&
    isWorkingSet(set.type) &&
    set.weightKg !== null &&
    set.weightKg > 0 &&
    set.reps !== null &&
    set.reps > 0
  );
}

/**
 * Records computed FROM SCRATCH over every finished session — that's what makes edits and
 * deletions correct (an incremental update can't know the runner-up once the holder is gone).
 * Ties keep the EARLIEST achievement: matching a record isn't breaking it.
 */
export function computeRecords(sessions: RecordSession[]): ExerciseRecords {
  const ordered = [...sessions].sort(
    (a, b) =>
      a.startedAt.getTime() - b.startedAt.getTime() || a.workoutId.localeCompare(b.workoutId),
  );
  const records: ExerciseRecords = {
    maxWeight: null,
    bestE1RM: null,
    maxVolume: null,
    repsAtWeight: [],
  };
  const byWeight = new Map<number, RecordEntry>();
  const beats = (current: RecordEntry | null, value: number) =>
    current === null || value > current.value;

  for (const session of ordered) {
    let volume = 0;
    for (const set of session.sets) {
      if (!qualifies(set)) continue;
      const entry = (value: number): RecordEntry => ({
        value,
        weightKg: set.weightKg,
        reps: set.reps,
        workoutId: session.workoutId,
        achievedAt: session.startedAt,
      });

      volume += set.weightKg * set.reps;
      if (beats(records.maxWeight, set.weightKg)) records.maxWeight = entry(set.weightKg);

      const e1rm = epley1RM(set.weightKg, set.reps);
      if (e1rm !== null && beats(records.bestE1RM, round(e1rm, 1)))
        records.bestE1RM = entry(round(e1rm, 1));

      if (beats(byWeight.get(set.weightKg) ?? null, set.reps))
        byWeight.set(set.weightKg, entry(set.reps));
    }
    if (volume > 0 && beats(records.maxVolume, round(volume))) {
      records.maxVolume = {
        value: round(volume),
        weightKg: 0,
        reps: 0,
        workoutId: session.workoutId,
        achievedAt: session.startedAt,
      };
    }
  }

  records.repsAtWeight = [...byWeight.values()].sort((a, b) => a.weightKg - b.weightKg);
  return records;
}

export interface NewRecord {
  type: RecordType;
  value: number;
  previous: number;
  weightKg: number;
  reps: number;
}

/**
 * Records that `workoutId` broke. `others` = records computed WITHOUT this workout, so:
 * - editing a session that already held a record compares against the runner-up, not itself;
 * - the result is the same however many times it's recomputed (idempotent).
 * The first session of an exercise is the baseline (no "new records"), and so is the first time a
 * given weight is lifted — otherwise every new weight would celebrate a rep PR.
 */
export function newRecordsFor(
  others: ExerciseRecords,
  after: ExerciseRecords,
  workoutId: string,
): NewRecord[] {
  const before = others;
  const found: NewRecord[] = [];
  const check = (
    type: RecordType,
    prev: RecordEntry | null | undefined,
    next: RecordEntry | null,
  ) => {
    if (prev && next && next.workoutId === workoutId && next.value > prev.value) {
      found.push({
        type,
        value: next.value,
        previous: prev.value,
        weightKg: next.weightKg,
        reps: next.reps,
      });
    }
  };

  check('maxWeight', before.maxWeight, after.maxWeight);
  check('bestE1RM', before.bestE1RM, after.bestE1RM);
  check('maxVolume', before.maxVolume, after.maxVolume);
  const previousAtWeight = new Map(before.repsAtWeight.map((r) => [r.weightKg, r]));
  for (const entry of after.repsAtWeight)
    check('repsAtWeight', previousAtWeight.get(entry.weightKg), entry);
  return found;
}
