import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Translatable } from '../../common/utils/translatable.util';
import { SLUG_PATTERN } from '../exercises/dto/exercise-query.dto';
import {
  FOOD_CATEGORIES,
  FOOD_TAGS,
  MEAL_TYPES,
  NUTRITION_GOALS,
  type FoodCategory,
  type FoodTag,
  type MealType,
  type NutritionGoal,
} from './nutrition.constants';
import { foodSearchText, kcalMatchesMacros } from './nutrition.util';
import { Food, type Per100g } from './schemas/food.schema';
import { MealSuggestion } from './schemas/meal-suggestion.schema';
import { NutritionGuideline } from './schemas/nutrition-guideline.schema';

export interface SeedFood {
  slug: string;
  name: Translatable;
  category: FoodCategory;
  per100g: Per100g;
  tags: FoodTag[];
}

export interface SeedMealSuggestion {
  slug: string;
  name: Translatable;
  description: Translatable;
  goal: NutritionGoal;
  mealType: MealType;
  items: { foodSlug: string; grams: number }[];
  isSample: boolean;
  sortOrder: number;
}

export interface SeedGuideline {
  slug: string;
  goals: NutritionGoal[];
  title: Translatable;
  summary: Translatable;
  body: Translatable;
  sortOrder: number;
}

export interface NutritionSeedFile {
  foods: SeedFood[];
  mealSuggestions: SeedMealSuggestion[];
  guidelines: SeedGuideline[];
}

export interface SeedReport {
  inserted: number;
  updated: number;
  skipped: number;
}

/** src/database/seeds/nutrition.seed.json (copied to dist by nest-cli assets). */
export const NUTRITION_SEED_PATH = join(
  __dirname,
  '..',
  '..',
  'database',
  'seeds',
  'nutrition.seed.json',
);

export function loadNutritionSeed(path = NUTRITION_SEED_PATH): NutritionSeedFile {
  return JSON.parse(readFileSync(path, 'utf8')) as NutritionSeedFile;
}

/** Structural checks so a typo in the JSON fails loudly instead of seeding garbage. */
export function validateNutritionSeed(data: NutritionSeedFile): string[] {
  const errors: string[] = [];
  const bilingual = (t: Translatable | undefined) => Boolean(t?.es?.trim() && t?.en?.trim());
  const checkSlug = (kind: string, slug: string, seen: Set<string>) => {
    if (!SLUG_PATTERN.test(slug)) errors.push(`${kind} ${slug}: invalid slug`);
    if (seen.has(slug)) errors.push(`${kind} ${slug}: duplicated slug`);
    seen.add(slug);
  };

  const foods = new Set<string>();
  for (const f of data.foods) {
    const at = `food ${f.slug}`;
    checkSlug('food', f.slug, foods);
    if (!bilingual(f.name)) errors.push(`${at}: name needs es and en`);
    if (!FOOD_CATEGORIES.includes(f.category)) errors.push(`${at}: bad category ${f.category}`);
    const macros = [f.per100g?.kcal, f.per100g?.proteinG, f.per100g?.carbsG, f.per100g?.fatG];
    if (macros.some((v) => typeof v !== 'number' || v < 0)) {
      errors.push(`${at}: per100g needs kcal/proteinG/carbsG/fatG >= 0`);
    } else {
      if (f.per100g.proteinG + f.per100g.carbsG + f.per100g.fatG > 100)
        errors.push(`${at}: macros exceed 100 g`);
      if (!kcalMatchesMacros(f.per100g)) errors.push(`${at}: kcal doesn't match 4/4/9 macros`);
    }
    for (const tag of f.tags) if (!FOOD_TAGS.includes(tag)) errors.push(`${at}: bad tag ${tag}`);
    if (f.tags.includes('vegan') && !f.tags.includes('vegetarian'))
      errors.push(`${at}: vegan must also be vegetarian`);
  }

  const suggestions = new Set<string>();
  for (const s of data.mealSuggestions) {
    const at = `meal ${s.slug}`;
    checkSlug('meal', s.slug, suggestions);
    if (!bilingual(s.name)) errors.push(`${at}: name needs es and en`);
    if (!bilingual(s.description)) errors.push(`${at}: description needs es and en`);
    if (!NUTRITION_GOALS.includes(s.goal)) errors.push(`${at}: bad goal ${s.goal}`);
    if (!MEAL_TYPES.includes(s.mealType)) errors.push(`${at}: bad mealType ${s.mealType}`);
    if (!s.items.length) errors.push(`${at}: no items`);
    for (const item of s.items) {
      if (!foods.has(item.foodSlug)) errors.push(`${at}: unknown food ${item.foodSlug}`);
      if (!Number.isInteger(item.grams) || item.grams < 1 || item.grams > 2000)
        errors.push(`${at}: bad grams for ${item.foodSlug}`);
    }
  }

  const guidelines = new Set<string>();
  for (const g of data.guidelines) {
    const at = `guideline ${g.slug}`;
    checkSlug('guideline', g.slug, guidelines);
    if (!g.goals.length) errors.push(`${at}: no goals`);
    for (const goal of g.goals)
      if (!NUTRITION_GOALS.includes(goal)) errors.push(`${at}: bad goal ${goal}`);
    for (const field of ['title', 'summary', 'body'] as const)
      if (!bilingual(g[field])) errors.push(`${at}: ${field} needs es and en`);
  }
  return errors;
}

/**
 * Idempotent upsert by slug (same contract as the exercise seeder).
 * - Default: inserts what's missing, never touches existing docs (admin edits win).
 * - `update: true`: overwrites existing, non-deleted docs with the JSON.
 * Soft-deleted items keep their slug, so they're found and skipped — never resurrected.
 */
@Injectable()
export class NutritionSeeder {
  private readonly logger = new Logger(NutritionSeeder.name);

  constructor(
    @InjectModel(Food.name) private readonly foods: Model<Food>,
    @InjectModel(MealSuggestion.name) private readonly suggestions: Model<MealSuggestion>,
    @InjectModel(NutritionGuideline.name) private readonly guidelines: Model<NutritionGuideline>,
  ) {}

  async run(
    data: NutritionSeedFile,
    options: { update: boolean },
  ): Promise<{ foods: SeedReport; mealSuggestions: SeedReport; guidelines: SeedReport }> {
    const errors = validateNutritionSeed(data);
    if (errors.length) throw new Error(`Invalid nutrition seed:\n- ${errors.join('\n- ')}`);

    // Foods first: suggestions reference them by slug.
    const foods = await upsertAll(this.foods, data.foods, options.update, (f) => ({
      ...f,
      searchText: foodSearchText(f.name),
    }));
    const mealSuggestions = await upsertAll(
      this.suggestions,
      data.mealSuggestions,
      options.update,
      (s) => s,
    );
    const guidelines = await upsertAll(this.guidelines, data.guidelines, options.update, (g) => g);
    const report = { foods, mealSuggestions, guidelines };
    this.logger.log(JSON.stringify(report));
    return report;
  }
}

async function upsertAll<
  T extends { slug: string },
  D extends { slug: string; deletedAt: Date | null },
>(model: Model<D>, items: T[], update: boolean, toDoc: (item: T) => object): Promise<SeedReport> {
  const report: SeedReport = { inserted: 0, updated: 0, skipped: 0 };
  const existing = new Map(
    (
      await model
        .find({ slug: { $in: items.map((i) => i.slug) } }, { slug: 1, deletedAt: 1 })
        .lean<D[]>()
    ).map((doc) => [doc.slug, doc]),
  );

  for (const item of items) {
    const current = existing.get(item.slug);
    if (!current) {
      await model.create(toDoc(item));
      report.inserted++;
    } else if (update && !current.deletedAt) {
      await model.updateOne({ slug: item.slug }, { $set: toDoc(item) });
      report.updated++;
    } else {
      report.skipped++;
    }
  }
  return report;
}
