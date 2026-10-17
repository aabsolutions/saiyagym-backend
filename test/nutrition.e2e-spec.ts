import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ageInYears } from '../src/modules/nutrition/nutrition-calculator';
import { loadNutritionSeed, NutritionSeeder } from '../src/modules/nutrition/nutrition.seeder';
import { createTestApp, createTestUser } from './utils/create-test-app';

interface Page<T> {
  items: T[];
  meta: { page: number; limit: number; total: number };
}
interface Food {
  id: string;
  slug: string;
  name: string;
  category: string;
  tags: string[];
}
interface Suggestion {
  id: string;
  slug: string;
  goal: string;
  mealType: string;
  isSample: boolean;
  items: { foodSlug: string; grams: number; kcal: number }[];
  totals: { kcal: number; proteinG: number };
}

describe('Nutrition (e2e)', () => {
  const seed = loadNutritionSeed();
  let app: INestApplication<App>;
  let db: Connection;
  let free: string;
  let premium: string;
  let admin: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test, lang = 'es') =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', lang);
  const get = <T>(token: string, path: string, lang = 'es', status = 200) =>
    as(token, http().get(`/api/v1${path}`), lang)
      .expect(status)
      .then((res) => res.body as T);
  const calc = (token: string, body: object, lang = 'es') =>
    as(token, http().post('/api/v1/nutrition/calculator'), lang).send(body);
  const suggestionId = async (slug: string) =>
    String((await db.collection('meal_suggestions').findOne({ slug }))!._id);

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<Connection>(getConnectionToken());
    await app.get(NutritionSeeder).run(seed, { update: false });

    free = (await createTestUser(app)).token;
    premium = (await createTestUser(app, { premium: true })).token;
    const adminUser = await createTestUser(app);
    await db
      .collection('users')
      .updateOne({ _id: adminUser.id as never }, { $set: { role: 'admin' } });
    admin = await app
      .get(JwtService)
      .signAsync({ sub: adminUser.id, role: 'admin', sid: randomUUID() });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('seed', () => {
    it('is idempotent: a second run inserts nothing', async () => {
      const report = await app.get(NutritionSeeder).run(seed, { update: false });
      expect(report.foods).toEqual({ inserted: 0, updated: 0, skipped: seed.foods.length });
      expect(report.mealSuggestions.inserted).toBe(0);
      expect(report.guidelines.inserted).toBe(0);
    });
  });

  describe('foods', () => {
    it('requires authentication', async () => {
      await http().get('/api/v1/nutrition/foods').expect(401);
    });

    it('lists the whole catalog paginated, localized and sorted by name', async () => {
      const page = await get<Page<Food>>(free, '/nutrition/foods?limit=100', 'en');
      expect(page.meta.total).toBe(seed.foods.length);
      const names = page.items.map((f) => f.name);
      expect(names).toContain('Chicken breast');
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
      expect(page.items[0]).not.toHaveProperty('searchText');
    });

    it('filters by category', async () => {
      const page = await get<Page<Food>>(free, '/nutrition/foods?category=fruits&limit=100');
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((f) => f.category === 'fruits')).toBe(true);
    });

    it('filters by several tags (all must match)', async () => {
      const page = await get<Page<Food>>(
        free,
        '/nutrition/foods?tag=vegan&tag=high-protein&limit=100',
      );
      expect(page.items.map((f) => f.slug).sort()).toEqual(['firm-tofu', 'tempeh']);
    });

    it('text search is partial, accent-insensitive and matches any language', async () => {
      const slugs = async (q: string) =>
        (await get<Page<Food>>(free, `/nutrition/foods?q=${encodeURIComponent(q)}`)).items.map(
          (f) => f.slug,
        );
      expect(await slugs('platano')).toEqual(['banana']);
      expect(await slugs('PLÁT')).toEqual(['banana']);
      expect(await slugs('tuna')).toEqual(['canned-tuna-water']);
      expect(await slugs('.*')).toEqual([]); // regex metacharacters are literal
    });

    it('rejects unknown filters', async () => {
      await get(free, '/nutrition/foods?tag=keto', 'es', 400);
      await get(free, '/nutrition/foods?category=candy', 'es', 400);
    });

    it('detail by id; unknown id → 404 FOOD_NOT_FOUND', async () => {
      const id = String((await db.collection('foods').findOne({ slug: 'salmon' }))!._id);
      expect(await get<Food>(free, `/nutrition/foods/${id}`, 'en')).toMatchObject({
        slug: 'salmon',
        name: 'Salmon',
        per100g: { kcal: 208, proteinG: 20, carbsG: 0, fatG: 13 },
      });
      const body = await get<{ code: string }>(free, `/nutrition/foods/${randomUUID()}`, 'es', 404);
      expect(body.code).toBe('FOOD_NOT_FOUND');
    });
  });

  describe('meal suggestions', () => {
    type SuggestionPage = Page<Suggestion> & {
      limitedByPlan: boolean;
      lockedCount: number;
      disclaimer: string;
    };
    const samples = seed.mealSuggestions.filter((s) => s.isSample);

    it('Free sees only the samples, how many are locked, and the disclaimer', async () => {
      const page = await get<SuggestionPage>(free, '/nutrition/meal-suggestions?limit=100');
      expect(page.limitedByPlan).toBe(true);
      expect(page.meta.total).toBe(samples.length);
      expect(page.items.every((s) => s.isSample)).toBe(true);
      expect(page.lockedCount).toBe(seed.mealSuggestions.length - samples.length);
      expect(page.disclaimer).toMatch(/profesional/);
    });

    it('Premium sees every suggestion', async () => {
      const page = await get<SuggestionPage>(premium, '/nutrition/meal-suggestions?limit=100');
      expect(page).toMatchObject({ limitedByPlan: false, lockedCount: 0 });
      expect(page.meta.total).toBe(seed.mealSuggestions.length);
    });

    it('filters by goal and meal type, with per-item and total macros', async () => {
      const page = await get<SuggestionPage>(
        premium,
        '/nutrition/meal-suggestions?goal=cut&mealType=post_workout',
        'en',
      );
      expect(page.items.map((s) => s.slug).sort()).toEqual([
        'cut-post-chicken-potato',
        'cut-post-shake-berries',
      ]);
      for (const s of page.items) {
        expect(s).toMatchObject({ goal: 'cut', mealType: 'post_workout' });
        const sum = s.items.reduce((acc, item) => acc + item.kcal, 0);
        expect(Math.abs(sum - s.totals.kcal)).toBeLessThanOrEqual(s.items.length);
      }
      // 30 g whey (380) + 250 g skim milk (34) + 100 g blueberries (57) = 114 + 85 + 57
      const shake = page.items.find((s) => s.slug === 'cut-post-shake-berries')!;
      expect(shake.totals.kcal).toBe(256);
    });

    it('Free filtered by a goal still gets only samples', async () => {
      const page = await get<SuggestionPage>(free, '/nutrition/meal-suggestions?goal=bulk');
      expect(page.items.map((s) => s.slug).sort()).toEqual(
        samples
          .filter((s) => s.goal === 'bulk')
          .map((s) => s.slug)
          .sort(),
      );
    });

    it('detail: samples are open to Free, the rest is Premium (403 PLAN_FEATURE_REQUIRED)', async () => {
      const sample = await suggestionId(samples[0]!.slug);
      const locked = await suggestionId('bulk-beef-pasta');
      await get(free, `/nutrition/meal-suggestions/${sample}`);
      const body = await get<{ code: string; details: unknown }>(
        free,
        `/nutrition/meal-suggestions/${locked}`,
        'es',
        403,
      );
      expect(body).toMatchObject({
        code: 'PLAN_FEATURE_REQUIRED',
        details: { feature: 'fullNutrition' },
      });
      await get(premium, `/nutrition/meal-suggestions/${locked}`);
    });
  });

  describe('guidelines', () => {
    it('by goal: general ones plus the goal-specific ones, on every plan', async () => {
      const list = await get<{ items: { slug: string; title: string }[]; disclaimer: string }>(
        free,
        '/nutrition/guidelines?goal=cut',
        'en',
      );
      const slugs = list.items.map((g) => g.slug);
      expect(slugs).toEqual(expect.arrayContaining(['daily-protein', 'cut-deficit']));
      expect(slugs).not.toContain('bulk-surplus');
      expect(list.items[0]!.title).toBe('Daily protein: a rough guide');
      expect(list.disclaimer).toMatch(/professional/);
    });
  });

  describe('calculator', () => {
    const body = {
      goal: 'maintenance',
      activityLevel: 'moderate',
      sex: 'male',
      ageYears: 30,
      heightCm: 180,
      weightKg: 80,
    };

    it('computes from the request data, with a translated disclaimer', async () => {
      const res = await calc(free, body).expect(200);
      expect(res.body).toMatchObject({
        formula: 'mifflin_st_jeor',
        bmrKcal: 1780,
        tdeeKcal: 2759,
        targetKcal: 2759,
        macros: { proteinG: 144, fatG: 92, carbsG: 339 },
        input: { activityFactor: 1.55, sources: { sex: 'request', weightKg: 'request' } },
      });
      expect((res.body as { disclaimer: string }).disclaimer).toMatch(
        /consulta con un profesional/i,
      );

      const en = await calc(free, body, 'en').expect(200);
      expect((en.body as { disclaimer: string }).disclaimer).toMatch(
        /consult a health professional/i,
      );
    });

    it('fills gaps from the profile and the latest body weight, and stores nothing', async () => {
      const user = await createTestUser(app);
      const birthDate = '1990-03-10';
      await as(user.token, http().patch('/api/v1/users/me'))
        .send({ profile: { sex: 'female', birthDate, heightCm: 165 } })
        .expect(200);
      for (const [measuredAt, weightKg] of [
        ['2026-01-01T08:00:00Z', 70],
        ['2026-03-01T08:00:00Z', 66],
      ] as const) {
        await as(user.token, http().post('/api/v1/body-metrics'))
          .send({ measuredAt, weightKg })
          .expect(201);
      }
      const before = await db.collection('users').findOne({ _id: user.id as never });

      const res = await calc(user.token, { goal: 'cut', activityLevel: 'light' }).expect(200);
      expect(res.body).toMatchObject({
        input: {
          sex: 'female',
          ageYears: ageInYears(new Date(`${birthDate}T00:00:00Z`), new Date()),
          heightCm: 165,
          weightKg: 66,
          sources: {
            sex: 'profile',
            ageYears: 'profile',
            heightCm: 'profile',
            weightKg: 'body_metrics',
          },
        },
        macros: { proteinG: 145 }, // 66 × 2.2
      });
      expect(await db.collection('users').findOne({ _id: user.id as never })).toEqual(before);
    });

    it('400 NUTRITION_PROFILE_INCOMPLETE listing what is missing', async () => {
      const res = await calc(free, { goal: 'bulk', activityLevel: 'active', heightCm: 175 }).expect(
        400,
      );
      expect(res.body).toMatchObject({
        code: 'NUTRITION_PROFILE_INCOMPLETE',
        details: { missing: ['sex', 'ageYears', 'weightKg'], outOfRange: [] },
      });
    });

    it('validates the request (goal, activity, adult age, ranges)', async () => {
      await calc(free, { ...body, goal: 'shred' }).expect(400);
      await calc(free, { ...body, activityLevel: 'extreme' }).expect(400);
      await calc(free, { ...body, ageYears: 16 }).expect(400);
      await calc(free, { ...body, weightKg: 10 }).expect(400);
      await calc(free, { ...body, sex: 'other' }).expect(400);
    });
  });

  describe('admin', () => {
    const adminReq = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token = admin) =>
      as(token, http()[method](`/api/v1/admin/nutrition${path}`));

    it('is admin-only', async () => {
      await adminReq('get', '/foods', free).expect(403);
      await adminReq('post', '/guidelines', premium).expect(403);
    });

    it('food CRUD with raw translation maps; slugs stay reserved after delete', async () => {
      const created = await adminReq('post', '/foods')
        .send({
          slug: 'test-seitan',
          name: { es: 'Seitán', en: 'Seitan' },
          category: 'other',
          per100g: { kcal: 370, proteinG: 75, carbsG: 14, fatG: 1.9 },
          tags: ['vegan', 'vegetarian', 'high-protein'],
        })
        .expect(201);
      const food = created.body as { id: string; name: Record<string, string> };
      expect(food.name).toEqual({ es: 'Seitán', en: 'Seitan' });

      const dup = await adminReq('post', '/foods')
        .send({
          slug: 'test-seitan',
          name: { es: 'Otro' },
          category: 'other',
          per100g: { kcal: 1, proteinG: 0, carbsG: 0, fatG: 0 },
        })
        .expect(409);
      expect((dup.body as { code: string }).code).toBe('NUTRITION_SLUG_TAKEN');

      await adminReq('patch', `/foods/${food.id}`).send({ name: null }).expect(400);
      await adminReq('patch', `/foods/${food.id}`)
        .send({ name: { es: 'Gluten de trigo', en: 'Wheat gluten' } })
        .expect(200);
      // Renaming refreshes the search text.
      const found = await get<Page<Food>>(free, '/nutrition/foods?q=gluten de trigo');
      expect(found.items.map((f) => f.slug)).toEqual(['test-seitan']);

      await adminReq('delete', `/foods/${food.id}`).expect(204);
      await get(free, `/nutrition/foods/${food.id}`, 'es', 404);
      await adminReq('post', '/foods')
        .send({
          slug: 'test-seitan',
          name: { es: 'Seitán' },
          category: 'other',
          per100g: { kcal: 370, proteinG: 75, carbsG: 14, fatG: 1.9 },
        })
        .expect(409);
    });

    it('meal suggestions validate their foods; a food in use cannot be deleted', async () => {
      const unknown = await adminReq('post', '/meal-suggestions')
        .send({
          slug: 'test-meal',
          name: { es: 'Prueba' },
          goal: 'bulk',
          mealType: 'snack',
          items: [{ foodSlug: 'ghost-food', grams: 100 }],
        })
        .expect(400);
      expect(unknown.body).toMatchObject({
        code: 'FOOD_NOT_FOUND',
        details: { missing: ['ghost-food'] },
      });

      const created = await adminReq('post', '/meal-suggestions')
        .send({
          slug: 'test-meal',
          name: { es: 'Prueba', en: 'Test' },
          goal: 'bulk',
          mealType: 'snack',
          items: [{ foodSlug: 'banana', grams: 120 }],
        })
        .expect(201);
      expect(created.body).toMatchObject({ isSample: false, sortOrder: 0, description: {} });

      const bananaId = String((await db.collection('foods').findOne({ slug: 'banana' }))!._id);
      const inUse = await adminReq('delete', `/foods/${bananaId}`).expect(409);
      expect((inUse.body as { code: string; details: { mealSuggestions: string[] } }).code).toBe(
        'FOOD_IN_USE',
      );
      expect(
        (inUse.body as { details: { mealSuggestions: string[] } }).details.mealSuggestions,
      ).toContain('test-meal');

      const id = (created.body as { id: string }).id;
      await adminReq('patch', `/meal-suggestions/${id}`).send({ isSample: true }).expect(200);
      await get(free, `/nutrition/meal-suggestions/${id}`);
      await adminReq('delete', `/meal-suggestions/${id}`).expect(204);
      await adminReq('delete', `/meal-suggestions/${id}`).expect(404);
    });

    it('guideline CRUD', async () => {
      const created = await adminReq('post', '/guidelines')
        .send({
          slug: 'test-sleep',
          goals: ['bulk', 'cut'],
          title: { es: 'Sueño', en: 'Sleep' },
          summary: { es: 'Duerme 7-9 h.', en: 'Sleep 7-9 h.' },
          body: { es: 'Texto.', en: 'Text.' },
        })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await adminReq('patch', `/guidelines/${id}`).send({ goals: [] }).expect(400);
      await adminReq('patch', `/guidelines/${id}`)
        .send({ goals: ['maintenance'] })
        .expect(200);
      const forBulk = await get<{ items: { slug: string }[] }>(
        free,
        '/nutrition/guidelines?goal=bulk',
      );
      expect(forBulk.items.map((g) => g.slug)).not.toContain('test-sleep');
      await adminReq('delete', `/guidelines/${id}`).expect(204);
      await get(free, `/nutrition/guidelines/${id}`, 'es', 404);
    });
  });
});
