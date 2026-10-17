import type {
  DeloadConfig,
  ProgressionRule,
  SetType,
  TargetSet,
} from '../../../common/constants/training';
import { ProgressionService, type ProgressionInput } from './progression.service';
import type { ExercisePerformance, PerformedSet } from './workout-history.provider';

const service = new ProgressionService();

const target = (repsMin: number, repsMax: number, extra: Partial<TargetSet> = {}): TargetSet => ({
  type: 'normal',
  repsMin,
  repsMax,
  weightKg: null,
  percent1RM: null,
  restSeconds: 120,
  ...extra,
});

const done = (weightKg: number, reps: number, type: SetType = 'normal'): PerformedSet => ({
  type,
  weightKg,
  reps,
  completed: true,
});

const session = (...sets: PerformedSet[]): ExercisePerformance => ({
  performedAt: new Date('2024-01-01'),
  sets,
});

const input = (overrides: Partial<ProgressionInput>): ProgressionInput => ({
  targets: [target(8, 12), target(8, 12), target(8, 12)],
  rule: null,
  mechanic: 'compound',
  history: [],
  weekIndex: 0,
  deload: null,
  trainingMaxKg: null,
  progressionEnabled: true,
  ...overrides,
});

const weights = (result: { sets: { weightKg: number | null }[] }) =>
  result.sets.map((s) => s.weightKg);
const codes = (result: { notes: { code: string }[] }) => result.notes.map((n) => n.code);

const DOUBLE: ProgressionRule = { type: 'double_progression' };
const BLOCK: ProgressionRule = {
  type: 'percent_1rm',
  weeks: [{ percent: 70 }, { percent: 75 }, { percent: 80 }, { percent: 85 }],
};
const DELOAD_WEIGHT: DeloadConfig = { mode: 'weight', percent: 40 };
const DELOAD_SETS: DeloadConfig = { mode: 'sets', percent: 50 };

describe('ProgressionService', () => {
  describe('static prescription (every plan)', () => {
    it('keeps written weights and reps as-is', () => {
      const result = service.compute(
        input({ targets: [target(5, 5, { weightKg: 100 }), target(8, 10, { weightKg: 80 })] }),
      );
      expect(result.sets).toEqual([
        { type: 'normal', repsMin: 5, repsMax: 5, weightKg: 100, restSeconds: 120 },
        { type: 'normal', repsMin: 8, repsMax: 10, weightKg: 80, restSeconds: 120 },
      ]);
      expect(result.notes).toEqual([]);
      expect(result.referenceMax).toBeNull();
    });

    it('resolves %1RM against the training max, rounded to 2.5 kg for compounds', () => {
      const result = service.compute(
        input({ targets: [target(5, 5, { percent1RM: 72 })], trainingMaxKg: 140 }),
      );
      expect(weights(result)).toEqual([100]); // 100.8 → 100
      expect(result.referenceMax).toEqual({ kg: 140, source: 'training_max' });
      expect(codes(result)).toEqual(['PERCENT_OF_MAX']);
    });

    it('rounds to 1 kg for isolation exercises', () => {
      const result = service.compute(
        input({
          mechanic: 'isolation',
          targets: [target(10, 12, { percent1RM: 70 })],
          trainingMaxKg: 43,
        }),
      );
      expect(weights(result)).toEqual([30]); // 30.1 → 30
    });

    it('falls back to the best Epley e1RM in history (working, completed, 1–12 reps)', () => {
      const result = service.compute(
        input({
          targets: [target(3, 3, { percent1RM: 80 })],
          history: [
            session(done(60, 5, 'warmup'), done(100, 5), { ...done(130, 3), completed: false }),
            session(done(105, 3), done(90, 15)),
          ],
        }),
      );
      // best: 100×(1+5/30)=116.67 vs 105×1.1=115.5 → 116.7; warmup, failed and 15-rep sets ignored
      expect(result.referenceMax).toEqual({ kg: 116.7, source: 'estimated' });
      expect(weights(result)).toEqual([92.5]); // 93.36 → 92.5
    });

    it('a training max wins over the history estimate', () => {
      const result = service.compute(
        input({
          targets: [target(3, 3, { percent1RM: 50 })],
          history: [session(done(200, 5))],
          trainingMaxKg: 100,
        }),
      );
      expect(weights(result)).toEqual([50]);
      expect(result.referenceMax?.source).toBe('training_max');
    });

    it('leaves %-based weights empty when there is no reference max', () => {
      const result = service.compute(input({ targets: [target(5, 5, { percent1RM: 75 })] }));
      expect(weights(result)).toEqual([null]);
      expect(codes(result)).toEqual(['NO_REFERENCE_MAX']);
    });

    it('reports each note once', () => {
      const result = service.compute(
        input({
          targets: [target(5, 5, { percent1RM: 70 }), target(5, 5, { percent1RM: 75 })],
          trainingMaxKg: 100,
        }),
      );
      expect(codes(result)).toEqual(['PERCENT_OF_MAX']);
    });
  });

  describe('plan without autoProgression', () => {
    it('ignores the rule and the deload week, and says so', () => {
      const result = service.compute(
        input({
          progressionEnabled: false,
          rule: DOUBLE,
          deload: DELOAD_WEIGHT,
          targets: [target(8, 12, { weightKg: 50 })],
          history: [session(done(50, 12))],
        }),
      );
      expect(weights(result)).toEqual([50]);
      expect(codes(result)).toEqual(['PROGRESSION_DISABLED']);
    });
  });

  describe('double progression', () => {
    it('without history keeps the prescription (NO_HISTORY)', () => {
      const result = service.compute(
        input({ rule: DOUBLE, targets: [target(8, 12, { weightKg: 60 }), target(8, 12)] }),
      );
      expect(weights(result)).toEqual([60, null]);
      expect(codes(result)).toEqual(['NO_HISTORY']);
    });

    it('treats a last session with only warmups / unfinished sets as no history', () => {
      const result = service.compute(
        input({
          rule: DOUBLE,
          history: [session(done(40, 10, 'warmup'), { ...done(80, 12), completed: false })],
        }),
      );
      expect(codes(result)).toEqual(['NO_HISTORY']);
    });

    it('adds 2.5 kg (compound) when every working set hit the top of the range', () => {
      const result = service.compute(
        input({ rule: DOUBLE, history: [session(done(80, 12), done(80, 12), done(80, 13))] }),
      );
      expect(weights(result)).toEqual([82.5, 82.5, 82.5]);
      expect(result.notes).toEqual([{ code: 'INCREASE', params: { incrementKg: 2.5 } }]);
    });

    it('adds 1 kg by default for isolation exercises', () => {
      const result = service.compute(
        input({
          rule: DOUBLE,
          mechanic: 'isolation',
          history: [session(done(12, 12), done(12, 12), done(12, 12))],
        }),
      );
      expect(weights(result)).toEqual([13, 13, 13]);
    });

    it('uses the rule’s custom increment', () => {
      const result = service.compute(
        input({
          rule: { type: 'double_progression', incrementKg: 5 },
          history: [session(done(100, 12), done(100, 12), done(100, 12))],
        }),
      );
      expect(weights(result)).toEqual([105, 105, 105]);
    });

    it('holds the weight when any set fell short of the top of its range', () => {
      const result = service.compute(
        input({ rule: DOUBLE, history: [session(done(80, 12), done(80, 11), done(80, 9))] }),
      );
      expect(weights(result)).toEqual([80, 80, 80]);
      expect(codes(result)).toEqual(['HOLD']);
    });

    it('holds when fewer sets were done than prescribed, reusing the last weight for the missing ones', () => {
      const result = service.compute(
        input({ rule: DOUBLE, history: [session(done(80, 12), done(77.5, 12))] }),
      );
      expect(weights(result)).toEqual([80, 77.5, 77.5]);
      expect(codes(result)).toEqual(['HOLD']);
    });

    it('works per set position (top set + back-offs), each with its own range', () => {
      const result = service.compute(
        input({
          rule: DOUBLE,
          targets: [target(4, 6), target(8, 10), target(8, 10)],
          history: [session(done(120, 6), done(100, 10), done(100, 10))],
        }),
      );
      expect(weights(result)).toEqual([122.5, 102.5, 102.5]);
    });

    it('leaves warmups untouched and does not count them', () => {
      const result = service.compute(
        input({
          rule: DOUBLE,
          targets: [target(8, 8, { type: 'warmup', weightKg: 40 }), target(8, 12), target(8, 12)],
          history: [session(done(40, 8, 'warmup'), done(80, 12), done(80, 12))],
        }),
      );
      expect(weights(result)).toEqual([40, 82.5, 82.5]);
    });

    it('only looks at the most recent session', () => {
      const result = service.compute(
        input({
          rule: DOUBLE,
          history: [
            session(done(80, 10), done(80, 10), done(80, 10)),
            session(done(80, 12), done(80, 12), done(80, 12)),
          ],
        }),
      );
      expect(codes(result)).toEqual(['HOLD']);
    });

    it('never increases on a deload week (holds, then deloads)', () => {
      const result = service.compute(
        input({
          rule: DOUBLE,
          deload: DELOAD_WEIGHT,
          history: [session(done(100, 12), done(100, 12), done(100, 12))],
        }),
      );
      expect(weights(result)).toEqual([60, 60, 60]);
      expect(codes(result)).toEqual(['HOLD', 'DELOAD_WEIGHT']);
    });
  });

  describe('percent of 1RM per week', () => {
    const fiveByFive = [target(5, 5), target(5, 5), target(5, 5)];

    it.each([
      [0, 70, 140],
      [1, 75, 150],
      [2, 80, 160],
      [3, 85, 170],
    ])('week index %i → %i % of the max', (weekIndex, percent, expected) => {
      const result = service.compute(
        input({ rule: BLOCK, targets: fiveByFive, trainingMaxKg: 200, weekIndex }),
      );
      expect(weights(result)).toEqual([expected, expected, expected]);
      expect(result.notes).toEqual([{ code: 'WEEK_PERCENT', params: { percent } }]);
    });

    it('cycles the weeks when the program is longer than the rule', () => {
      const result = service.compute(
        input({ rule: BLOCK, targets: fiveByFive, trainingMaxKg: 200, weekIndex: 5 }),
      );
      expect(weights(result)).toEqual([150, 150, 150]); // week 6 → 2nd entry
    });

    it('applies per-week reps and set count overrides (more or fewer sets)', () => {
      const rule: ProgressionRule = {
        type: 'percent_1rm',
        weeks: [
          { percent: 70, reps: 5, sets: 5 },
          { percent: 85, reps: 2, sets: 2 },
        ],
      };
      const week1 = service.compute(input({ rule, targets: [target(3, 6)], trainingMaxKg: 100 }));
      expect(week1.sets).toHaveLength(5);
      expect(week1.sets.every((s) => s.repsMin === 5 && s.repsMax === 5 && s.weightKg === 70)).toBe(
        true,
      );

      const week2 = service.compute(
        input({ rule, targets: fiveByFive, trainingMaxKg: 100, weekIndex: 1 }),
      );
      expect(week2.sets.map((s) => [s.repsMax, s.weightKg])).toEqual([
        [2, 85],
        [2, 85],
      ]);
    });

    it('keeps warmups (resolving their own %) before the working sets', () => {
      const result = service.compute(
        input({
          rule: BLOCK,
          targets: [target(5, 5, { type: 'warmup', percent1RM: 50 }), target(5, 5)],
          trainingMaxKg: 100,
          weekIndex: 3,
        }),
      );
      expect(result.sets.map((s) => [s.type, s.weightKg])).toEqual([
        ['warmup', 50],
        ['normal', 85],
      ]);
    });

    it('uses the estimated max when there is no training max', () => {
      const result = service.compute(
        input({ rule: BLOCK, targets: [target(5, 5)], history: [session(done(150, 1))] }),
      );
      expect(weights(result)).toEqual([105]);
      expect(result.referenceMax).toEqual({ kg: 150, source: 'estimated' });
    });

    it('leaves weights empty without any reference max', () => {
      const result = service.compute(input({ rule: BLOCK, targets: fiveByFive }));
      expect(weights(result)).toEqual([null, null, null]);
      expect(codes(result)).toEqual(['WEEK_PERCENT', 'NO_REFERENCE_MAX']);
    });

    it('honours the rule’s rounding', () => {
      const result = service.compute(
        input({
          rule: { ...BLOCK, roundingKg: 1 },
          targets: [target(5, 5)],
          trainingMaxKg: 101,
        }),
      );
      expect(weights(result)).toEqual([71]); // 70.7 → 71 (would be 70 with 2.5)
    });
  });

  describe('deload', () => {
    const working = [
      target(8, 8, { type: 'warmup', weightKg: 40 }),
      ...[1, 2, 3, 4].map(() => target(8, 8, { weightKg: 100 })),
    ];

    it('weight mode: −Y % on working sets, rounded; warmups untouched', () => {
      const result = service.compute(input({ targets: working, deload: DELOAD_WEIGHT }));
      expect(weights(result)).toEqual([40, 60, 60, 60, 60]);
      expect(result.notes).toEqual([{ code: 'DELOAD_WEIGHT', params: { percent: 40 } }]);
    });

    it('weight mode keeps unknown weights unknown', () => {
      const result = service.compute(input({ targets: [target(8, 8)], deload: DELOAD_WEIGHT }));
      expect(weights(result)).toEqual([null]);
    });

    it('sets mode: −Y % of working sets, warmups kept', () => {
      const result = service.compute(input({ targets: working, deload: DELOAD_SETS }));
      expect(result.sets.map((s) => s.type)).toEqual(['warmup', 'normal', 'normal']);
      expect(weights(result)).toEqual([40, 100, 100]);
    });

    it('sets mode never drops the last working set', () => {
      const result = service.compute(
        input({ targets: [target(8, 8, { weightKg: 50 })], deload: { mode: 'sets', percent: 90 } }),
      );
      expect(result.sets).toHaveLength(1);
    });

    it('a rule-level deload overrides the program’s', () => {
      const result = service.compute(
        input({
          targets: working,
          rule: { type: 'double_progression', deload: DELOAD_SETS },
          deload: DELOAD_WEIGHT,
          history: [session(done(100, 8), done(100, 8), done(100, 8), done(100, 8))],
        }),
      );
      expect(result.sets).toHaveLength(3); // warmup + 2 of 4 working sets
      expect(codes(result)).toEqual(['HOLD', 'DELOAD_SETS']);
    });

    it('stacks on top of the week’s percentage', () => {
      const result = service.compute(
        input({
          rule: BLOCK,
          targets: [target(5, 5)],
          trainingMaxKg: 200,
          weekIndex: 3,
          deload: DELOAD_WEIGHT,
        }),
      );
      expect(weights(result)).toEqual([102.5]); // 170 × 0.6
    });

    it('does nothing outside deload weeks, even if the rule defines one', () => {
      const result = service.compute(
        input({ targets: working, rule: { type: 'double_progression', deload: DELOAD_WEIGHT } }),
      );
      expect(weights(result)).toEqual([40, 100, 100, 100, 100]);
    });
  });
});
