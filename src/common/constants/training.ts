/** SPEC set types. Shared by routines (targets), workouts (logged sets) and progression. */
export const SET_TYPES = ['warmup', 'normal', 'dropset', 'failure'] as const;
export type SetType = (typeof SET_TYPES)[number];

/** Only these count for volume and PRs (SPEC). Warmups never do. */
export const WORKING_SET_TYPES: readonly SetType[] = ['normal', 'dropset', 'failure'];

export const isWorkingSet = (type: SetType): boolean => WORKING_SET_TYPES.includes(type);

export const PROGRESSION_TYPES = ['double_progression', 'percent_1rm'] as const;
export type ProgressionType = (typeof PROGRESSION_TYPES)[number];

export const DELOAD_MODES = ['weight', 'sets'] as const;
export type DeloadMode = (typeof DELOAD_MODES)[number];

/** Deload: reduce weight OR number of working sets by `percent` % (SPEC: "-Y % de peso o de series"). */
export interface DeloadConfig {
  mode: DeloadMode;
  percent: number;
}

/**
 * SPEC double progression: when every working set reaches the top of its rep range,
 * add `incrementKg` next time (default 2.5 kg compound / 1 kg isolation).
 */
export interface DoubleProgressionRule {
  type: 'double_progression';
  incrementKg?: number | null;
  roundingKg?: number | null;
  /** Overrides the program's deload config for this exercise. */
  deload?: DeloadConfig | null;
}

/** One entry per program week (cycled if the program is longer). reps/sets optionally override the routine. */
export interface WeekPercent {
  percent: number;
  reps?: number | null;
  sets?: number | null;
}

/** SPEC %1RM per week, powerlifting style (e.g. 70/75/80/85 %). */
export interface PercentOf1RMRule {
  type: 'percent_1rm';
  weeks: WeekPercent[];
  roundingKg?: number | null;
  deload?: DeloadConfig | null;
}

export type ProgressionRule = DoubleProgressionRule | PercentOf1RMRule;

/** Prescription for one set in a routine. `weightKg` and `percent1RM` are mutually exclusive. */
export interface TargetSet {
  type: SetType;
  repsMin: number;
  repsMax: number;
  weightKg: number | null;
  percent1RM: number | null;
  restSeconds: number;
}
