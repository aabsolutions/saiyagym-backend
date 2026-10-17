import {
  ACTIVITY_FACTORS,
  CALCULATOR_BOUNDS,
  type ActivityLevel,
  type FormulaSex,
  type NutritionGoal,
} from './nutrition.constants';

/**
 * Orientative energy + macro estimate. Pure: no I/O, nothing is stored (SPEC: general
 * suggestions, NOT medical advice — callers always attach the translated disclaimer).
 */
export interface CalculatorInput {
  sex: FormulaSex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: NutritionGoal;
}

export interface MacroSplit {
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Share of `targetKcal`, rounded; may not add up to exactly 100. */
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
}

export interface CalculatorResult {
  bmrKcal: number;
  tdeeKcal: number;
  targetKcal: number;
  /** The goal's adjustment went below the BMR, so the target was raised to the BMR. */
  clampedToBmr: boolean;
  macros: MacroSplit;
}

/**
 * Per-goal rules, deliberately conservative and within commonly cited ranges
 * (≈ ±10–20 % of maintenance, 1.6–2.2 g/kg protein, 20–35 % fat).
 */
export const GOAL_RULES: Record<
  NutritionGoal,
  { kcalFactor: number; proteinPerKg: number; fatShare: number }
> = {
  bulk: { kcalFactor: 1.1, proteinPerKg: 1.8, fatShare: 0.25 },
  cut: { kcalFactor: 0.8, proteinPerKg: 2.2, fatShare: 0.25 },
  maintenance: { kcalFactor: 1, proteinPerKg: 1.8, fatShare: 0.3 },
};

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** Mifflin-St Jeor (1990): 10·kg + 6.25·cm − 5·age + 5 (male) / − 161 (female). */
export function mifflinStJeor(
  input: Pick<CalculatorInput, 'sex' | 'ageYears' | 'heightCm' | 'weightKg'>,
): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears;
  return base + (input.sex === 'male' ? 5 : -161);
}

export function calculateNutrition(input: CalculatorInput): CalculatorResult {
  const rules = GOAL_RULES[input.goal];
  const bmr = mifflinStJeor(input);
  const tdee = bmr * ACTIVITY_FACTORS[input.activityLevel];
  const adjusted = tdee * rules.kcalFactor;
  const clampedToBmr = adjusted < bmr;
  const targetKcal = Math.round(clampedToBmr ? bmr : adjusted);

  const proteinG = Math.round(input.weightKg * rules.proteinPerKg);
  const fatG = Math.round((targetKcal * rules.fatShare) / KCAL_PER_G.fat);
  const remaining = targetKcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  const carbsG = Math.max(0, Math.round(remaining / KCAL_PER_G.carbs));

  const percent = (grams: number, kcalPerG: number) =>
    Math.round(((grams * kcalPerG) / targetKcal) * 100);

  return {
    bmrKcal: Math.round(bmr),
    tdeeKcal: Math.round(tdee),
    targetKcal,
    clampedToBmr,
    macros: {
      proteinG,
      carbsG,
      fatG,
      proteinPercent: percent(proteinG, KCAL_PER_G.protein),
      carbsPercent: percent(carbsG, KCAL_PER_G.carbs),
      fatPercent: percent(fatG, KCAL_PER_G.fat),
    },
  };
}

/** Whole years between a birth date and `today`, on UTC calendar dates. */
export function ageInYears(birthDate: Date, today: Date): number {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() &&
      today.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

export const CALCULATOR_FIELDS = ['sex', 'ageYears', 'heightCm', 'weightKg'] as const;
export type CalculatorField = (typeof CALCULATOR_FIELDS)[number];
export type FieldSource = 'request' | 'profile' | 'body_metrics';

export interface CalculatorOverrides {
  sex?: FormulaSex;
  ageYears?: number;
  heightCm?: number;
  weightKg?: number;
  activityLevel: ActivityLevel;
  goal: NutritionGoal;
}

export interface StoredProfile {
  sex: string | null;
  birthDate: Date | null;
  heightCm: number | null;
  /** Latest recorded body weight. */
  weightKg: number | null;
}

export type ResolvedInput =
  | { ok: true; input: CalculatorInput; sources: Record<CalculatorField, FieldSource> }
  | { ok: false; missing: CalculatorField[]; outOfRange: CalculatorField[] };

type BoundedField = keyof typeof CALCULATOR_BOUNDS;

function withinBounds(field: CalculatorField, value: unknown): boolean {
  if (!(field in CALCULATOR_BOUNDS)) return true;
  const { min, max } = CALCULATOR_BOUNDS[field as BoundedField];
  return typeof value === 'number' && value >= min && value <= max;
}

/**
 * Request values win (the DTO already enforces the bounds); gaps are filled from the profile
 * (sex, birth date, height) and the latest body metric (weight).
 * - Not available anywhere → `missing`. The profile's `other` sex can't feed the formula: missing.
 * - Stored but outside CALCULATOR_BOUNDS (e.g. a 16-year-old) → `outOfRange`, never used.
 */
export function resolveCalculatorInput(
  overrides: CalculatorOverrides,
  stored: StoredProfile,
  today: Date,
): ResolvedInput {
  const storedSex = stored.sex === 'male' || stored.sex === 'female' ? stored.sex : undefined;
  const storedAge = stored.birthDate ? ageInYears(stored.birthDate, today) : undefined;
  const candidates = {
    sex: [overrides.sex, storedSex, 'profile'],
    ageYears: [overrides.ageYears, storedAge, 'profile'],
    heightCm: [overrides.heightCm, stored.heightCm ?? undefined, 'profile'],
    weightKg: [overrides.weightKg, stored.weightKg ?? undefined, 'body_metrics'],
  } as const;

  const values: Partial<Record<CalculatorField, unknown>> = {};
  const sources: Partial<Record<CalculatorField, FieldSource>> = {};
  const missing: CalculatorField[] = [];
  const outOfRange: CalculatorField[] = [];
  for (const field of CALCULATOR_FIELDS) {
    const [fromRequest, fromStore, storeName] = candidates[field];
    if (fromRequest !== undefined) {
      values[field] = fromRequest;
      sources[field] = 'request';
    } else if (fromStore === undefined) {
      missing.push(field);
    } else if (!withinBounds(field, fromStore)) {
      outOfRange.push(field);
    } else {
      values[field] = fromStore;
      sources[field] = storeName;
    }
  }
  if (missing.length || outOfRange.length) return { ok: false, missing, outOfRange };

  return {
    ok: true,
    input: {
      ...(values as Pick<CalculatorInput, CalculatorField>),
      activityLevel: overrides.activityLevel,
      goal: overrides.goal,
    },
    sources: sources as Record<CalculatorField, FieldSource>,
  };
}
