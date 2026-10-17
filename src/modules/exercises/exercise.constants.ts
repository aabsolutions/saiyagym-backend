/** Canonical muscle groups (snake_case, stable API values; clients translate them). */
export const MUSCLES = [
  'chest',
  'lats',
  'upper_back',
  'traps',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'abductors',
  'calves',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'band',
  'smith',
  'other',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const MECHANICS = ['compound', 'isolation'] as const;
export type Mechanic = (typeof MECHANICS)[number];

export const CATEGORIES = ['strength', 'powerlifting_main', 'accessory'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Only weight+reps exists today; the field is there so time/distance can be added later. */
export const TRACKING_TYPES = ['weight_reps'] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

/** Best → worst. Order matters: it's the tier-list column order. */
export const TIERS = ['S', 'A', 'B', 'C'] as const;
export type Tier = (typeof TIERS)[number];

/** Training goals that have their own tier ranking. */
export const TIER_GOALS = ['hypertrophy', 'powerlifting'] as const;
export type TierGoal = (typeof TIER_GOALS)[number];

export type Tiers = Record<TierGoal, Tier | null>;
