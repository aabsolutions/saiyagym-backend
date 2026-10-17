/** Nutrition goals (SPEC: volumen, definición, mantenimiento). Not the training goal on the profile. */
export const NUTRITION_GOALS = ['bulk', 'cut', 'maintenance'] as const;
export type NutritionGoal = (typeof NUTRITION_GOALS)[number];

export const MEAL_TYPES = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'pre_workout',
  'post_workout',
] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const FOOD_CATEGORIES = [
  'meat',
  'fish',
  'eggs',
  'dairy',
  'legumes',
  'grains',
  'tubers',
  'fruits',
  'vegetables',
  'nuts_seeds',
  'fats_oils',
  'supplements',
  'other',
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

/**
 * Closed list (not an admin collection like exercise tags): clients translate these keys in their
 * own i18n files, and filters never hit a tag nobody can name. Adding one = code change.
 */
export const FOOD_TAGS = [
  'vegan',
  'vegetarian',
  'gluten-free',
  'lactose-free',
  'high-protein',
  'high-fiber',
  'low-fat',
] as const;
export type FoodTag = (typeof FOOD_TAGS)[number];

/** Mifflin-St Jeor multipliers (commonly used Harris-Benedict/McArdle values). */
export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;
export type ActivityLevel = keyof typeof ACTIVITY_FACTORS;
export const ACTIVITY_LEVELS = Object.keys(ACTIVITY_FACTORS) as ActivityLevel[];

/** Sexes the formula is defined for. The profile's `other` must be sent explicitly. */
export const FORMULA_SEXES = ['male', 'female'] as const;
export type FormulaSex = (typeof FORMULA_SEXES)[number];

/**
 * Inputs the calculator accepts (request DTO and stored profile alike). Mifflin-St Jeor is
 * validated for adults; a stored value outside these ranges is reported, never used.
 */
export const CALCULATOR_BOUNDS = {
  ageYears: { min: 18, max: 100 },
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 35, max: 250 },
} as const;
