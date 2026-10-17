import { MEAL_TYPES, NUTRITION_GOALS } from './nutrition.constants';
import {
  loadNutritionSeed,
  validateNutritionSeed,
  type NutritionSeedFile,
} from './nutrition.seeder';

describe('nutrition seed file', () => {
  const seed = loadNutritionSeed();

  it('is valid: bilingual, known enums, known foods, kcal consistent with macros', () => {
    expect(validateNutritionSeed(seed)).toEqual([]);
  });

  it('has ~80 foods, ~30 meal suggestions and 10 guidelines', () => {
    expect(seed.foods.length).toBeGreaterThanOrEqual(75);
    expect(seed.mealSuggestions.length).toBeGreaterThanOrEqual(30);
    expect(seed.guidelines).toHaveLength(10);
  });

  it('covers every goal × meal type, with a Free sample per goal', () => {
    for (const goal of NUTRITION_GOALS) {
      const forGoal = seed.mealSuggestions.filter((s) => s.goal === goal);
      for (const mealType of MEAL_TYPES) {
        expect(forGoal.some((s) => s.mealType === mealType)).toBe(true);
      }
      expect(forGoal.some((s) => s.isSample)).toBe(true);
      expect(forGoal.every((s) => s.isSample)).toBe(false);
      expect(seed.guidelines.some((g) => g.goals.includes(goal))).toBe(true);
    }
  });

  it('reports structural problems instead of seeding garbage', () => {
    const broken: NutritionSeedFile = {
      foods: [
        {
          slug: 'Bad Slug',
          name: { es: 'Tofu', en: '' },
          category: 'meat',
          per100g: { kcal: 500, proteinG: 10, carbsG: 10, fatG: 1 },
          tags: ['vegan', 'keto' as never],
        },
      ],
      mealSuggestions: [
        {
          ...seed.mealSuggestions[0]!,
          goal: 'shred' as never,
          items: [{ foodSlug: 'ghost', grams: 0 }],
        },
      ],
      guidelines: [{ ...seed.guidelines[0]!, goals: [] }],
    };
    const errors = validateNutritionSeed(broken).join('\n');
    expect(errors).toMatch(/food Bad Slug: invalid slug/);
    expect(errors).toMatch(/name needs es and en/);
    expect(errors).toMatch(/kcal doesn't match/);
    expect(errors).toMatch(/bad tag keto/);
    expect(errors).toMatch(/vegan must also be vegetarian/);
    expect(errors).toMatch(/bad goal shred/);
    expect(errors).toMatch(/unknown food ghost/);
    expect(errors).toMatch(/bad grams for ghost/);
    expect(errors).toMatch(/no goals/);
  });
});
