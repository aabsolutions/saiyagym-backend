/**
 * Single source of truth for what a plan can grant.
 * Adding a feature/limit: add the key here, to PlanFeatures/PlanLimits (schema + DTO),
 * to DEFAULT_PLANS, and (limits only) register a usage counter from the owning module.
 */
export const FEATURE_KEYS = [
  'progressPhotos',
  'autoProgression',
  'fullStats',
  'fullNutrition',
  'dataExport',
  'premiumSounds',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Countable resources. `null` limit = unlimited. */
export const LIMIT_KEYS = ['routines', 'activePrograms', 'customExercises'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export interface Entitlements {
  limits: Record<LimitKey, number | null>;
  /** How far back statistics go. `null` = full history. */
  statsHistoryDays: number | null;
  features: Record<FeatureKey, boolean>;
}
