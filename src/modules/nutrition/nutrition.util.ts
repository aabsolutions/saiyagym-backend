import type { Translatable } from '../../common/utils/translatable.util';
import type { Per100g } from './schemas/food.schema';
import type { MealItem } from './schemas/meal-suggestion.schema';

/** Lowercase, no diacritics, collapsed spaces: "Plátano  " → "platano". */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Value for `Food.searchText`: every translation of the name, normalized. */
export function foodSearchText(name: Translatable): string {
  return normalizeSearch([...new Set(Object.values(name))].join(' '));
}

export interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Macros of `grams` of a food. kcal whole, grams to one decimal. */
export function macrosFor(per100g: Per100g, grams: number): Macros {
  const factor = grams / 100;
  return {
    kcal: Math.round(per100g.kcal * factor),
    proteinG: round1(per100g.proteinG * factor),
    carbsG: round1(per100g.carbsG * factor),
    fatG: round1(per100g.fatG * factor),
  };
}

/**
 * Totals over the items whose food still exists (a soft-deleted food is skipped, not counted as 0).
 * Summed from unrounded values so totals don't drift from per-item rounding.
 */
export function mealTotals(items: MealItem[], foods: Map<string, Per100g>): Macros {
  const sum = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const item of items) {
    const per100g = foods.get(item.foodSlug);
    if (!per100g) continue;
    const factor = item.grams / 100;
    sum.kcal += per100g.kcal * factor;
    sum.proteinG += per100g.proteinG * factor;
    sum.carbsG += per100g.carbsG * factor;
    sum.fatG += per100g.fatG * factor;
  }
  return {
    kcal: Math.round(sum.kcal),
    proteinG: round1(sum.proteinG),
    carbsG: round1(sum.carbsG),
    fatG: round1(sum.fatG),
  };
}

/** kcal declared vs. Atwater (4/4/9). Tolerant: fiber and specific factors make labels differ. */
export function kcalMatchesMacros(per100g: Per100g): boolean {
  const atwater = 4 * per100g.proteinG + 4 * per100g.carbsG + 9 * per100g.fatG;
  return Math.abs(per100g.kcal - atwater) <= Math.max(20, per100g.kcal * 0.2);
}
