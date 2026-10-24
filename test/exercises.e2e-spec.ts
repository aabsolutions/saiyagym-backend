import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  ExercisesSeeder,
  type SeedExercise,
  type SeedFile,
} from '../src/modules/exercises/exercises.seeder';
import { createTestApp, uniqueEmail } from './utils/create-test-app';

const ex = (
  slug: string,
  es: string,
  en: string,
  rest: Pick<SeedExercise, 'primaryMuscle' | 'equipment' | 'mechanic' | 'tiers'> &
    Partial<SeedExercise>,
): SeedExercise => ({
  slug,
  name: { es, en },
  secondaryMuscles: [],
  category: 'strength',
  tags: [],
  ...rest,
});

/** Small, hand-picked catalog so every assertion below is exact. */
const FIXTURE: SeedFile = {
  tags: [
    { slug: 'basic', name: { es: 'Básico', en: 'Staple' } },
    { slug: 'unilateral', name: { es: 'Unilateral', en: 'Unilateral' } },
  ],
  exercises: [
    ex('t-bench', 'Press de banca', 'Bench press', {
      primaryMuscle: 'chest',
      equipment: 'barbell',
      mechanic: 'compound',
      tiers: { hypertrophy: 'A', powerlifting: 'S' },
      tags: ['basic'],
    }),
    ex('t-incline-db', 'Press inclinado con mancuernas', 'Incline dumbbell press', {
      primaryMuscle: 'chest',
      equipment: 'dumbbell',
      mechanic: 'compound',
      tiers: { hypertrophy: 'S', powerlifting: 'B' },
    }),
    ex('t-cable-fly', 'Aperturas en polea', 'Cable fly', {
      primaryMuscle: 'chest',
      equipment: 'cable',
      mechanic: 'isolation',
      tiers: { hypertrophy: 'A', powerlifting: 'C' },
    }),
    ex('t-pec-deck', 'Contractor de pecho', 'Pec deck', {
      primaryMuscle: 'chest',
      equipment: 'machine',
      mechanic: 'isolation',
      tiers: { hypertrophy: 'A', powerlifting: 'C' },
    }),
    ex('t-bulgarian', 'Sentadilla búlgara', 'Bulgarian split squat', {
      primaryMuscle: 'quads',
      equipment: 'dumbbell',
      mechanic: 'compound',
      tiers: { hypertrophy: 'S', powerlifting: 'B' },
      tags: ['unilateral'],
    }),
    ex('t-back-squat', 'Sentadilla trasera', 'Back squat', {
      primaryMuscle: 'quads',
      equipment: 'barbell',
      mechanic: 'compound',
      tiers: { hypertrophy: 'S', powerlifting: 'S' },
      tags: ['basic'],
    }),
    ex('t-leg-ext', 'Extensión de cuádriceps', 'Leg extension', {
      primaryMuscle: 'quads',
      equipment: 'machine',
      mechanic: 'isolation',
      tiers: { hypertrophy: 'A', powerlifting: 'C' },
    }),
    ex('t-face-pull', 'Face pull', 'Face pull', {
      primaryMuscle: 'rear_delts',
      equipment: 'cable',
      mechanic: 'isolation',
      tiers: { hypertrophy: null, powerlifting: 'B' },
    }),
  ],
};

describe('Exercises catalog (e2e)', () => {
  let app: INestApplication<App>;
  let ana: string; // access token
  let bruno: string;
  let admin: string;
  const ids = new Map<string, string>(); // slug → id

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test, lang = 'es') =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', lang);
  const list = (query: string, token = ana, lang = 'es') =>
    as(token, http().get(`/api/v1/exercises?${query}`), lang);
  const slugsOf = (body: { items: { slug: string | null; name: string }[] }) =>
    body.items.map((i) => i.slug ?? i.name);

  const register = async (prefix: string) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(prefix), password: 'secret-pass-1' })
        .expect(201)
    ).body as { user: { id: string; email: string }; tokens: { accessToken: string } };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    await app.get(ExercisesSeeder).run(FIXTURE, { update: false });

    const db = app.get<Connection>(getConnectionToken());
    for (const doc of await db.collection('exercises').find({ slug: /^t-/ }).toArray()) {
      ids.set(doc.slug as string, doc._id as unknown as string);
    }

    ana = (await register('ana')).tokens.accessToken;
    bruno = (await register('bruno')).tokens.accessToken;

    const adminUser = await register('admin');
    await db
      .collection('users')
      .updateOne({ _id: adminUser.user.id as never }, { $set: { role: 'admin' } });
    admin = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: adminUser.user.email, password: 'secret-pass-1' })
        .expect(200)
    ).body.tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /exercises — filters', () => {
    it('lists everything, sorted by localized name, with pagination meta', async () => {
      const res = await list('limit=3').expect(200);
      expect(res.body.meta).toEqual({ page: 1, limit: 3, total: 8 });
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        'Aperturas en polea',
        'Contractor de pecho',
        'Extensión de cuádriceps',
      ]);

      const page3 = await list('limit=3&page=3').expect(200);
      expect(page3.body.items).toHaveLength(2);
    });

    it('localizes by Accept-Language (and sorts by that language)', async () => {
      const res = await list('muscle=chest', ana, 'en-US').expect(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        'Bench press',
        'Cable fly',
        'Incline dumbbell press',
        'Pec deck',
      ]);
    });

    it.each([
      // Extensión < Sentadilla búlgara < Sentadilla trasera
      ['muscle=quads', ['t-leg-ext', 't-bulgarian', 't-back-squat']],
      ['equipment=dumbbell', ['t-incline-db', 't-bulgarian']],
      ['mechanic=isolation&muscle=chest', ['t-cable-fly', 't-pec-deck']],
      ['goal=hypertrophy&tier=S', ['t-incline-db', 't-bulgarian', 't-back-squat']],
      ['goal=powerlifting&tier=S', ['t-bench', 't-back-squat']],
      ['tag=basic', ['t-bench', 't-back-squat']],
      ['muscle=chest&sort=-name', ['t-incline-db', 't-bench', 't-pec-deck', 't-cable-fly']],
    ])('%s', async (query, expected) => {
      const res = await list(query).expect(200);
      expect(slugsOf(res.body)).toEqual(expected);
    });

    it('requires `goal` when filtering by tier', async () => {
      const res = await list('tier=S').expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual([expect.objectContaining({ field: 'goal' })]);
    });

    it('text search: whole words in any language, accent-insensitive, all words required', async () => {
      expect(slugsOf((await list('q=banca').expect(200)).body)).toEqual(['t-bench']);
      expect(slugsOf((await list('q=squat').expect(200)).body)).toEqual([
        't-bulgarian',
        't-back-squat',
      ]);
      expect(slugsOf((await list('q=bulgara').expect(200)).body)).toEqual(['t-bulgarian']);
      expect(slugsOf((await list('q=press%20inclinado').expect(200)).body)).toEqual([
        't-incline-db',
      ]);
    });

    it('text search: partial words fall back to substring match (typeahead)', async () => {
      expect(slugsOf((await list('q=senta').expect(200)).body)).toEqual([
        't-bulgarian',
        't-back-squat',
      ]);
      expect(slugsOf((await list('q=.*').expect(200)).body)).toEqual([]); // regex is escaped
    });
  });

  describe('favorites & personal tiers', () => {
    it('stores prefs per user and exposes them in listings', async () => {
      const id = ids.get('t-leg-ext')!;
      const res = await as(ana, http().patch(`/api/v1/exercises/${id}/prefs`))
        .send({ isFavorite: true, personalTiers: { hypertrophy: 'S' } })
        .expect(200);
      expect(res.body).toEqual({
        exerciseId: id,
        isFavorite: true,
        personalTiers: { hypertrophy: 'S', powerlifting: null },
      });

      // Partial update keeps the other field.
      await as(ana, http().patch(`/api/v1/exercises/${ids.get('t-cable-fly')!}/prefs`))
        .send({ isFavorite: true })
        .expect(200);

      const favorites = await list('favorites=true').expect(200);
      expect(slugsOf(favorites.body)).toEqual(['t-cable-fly', 't-leg-ext']);
      const legExt = favorites.body.items.find((i: { slug: string }) => i.slug === 't-leg-ext');
      expect(legExt).toMatchObject({
        isFavorite: true,
        personalTiers: { hypertrophy: 'S', powerlifting: null },
      });

      // Prefs are private.
      const forBruno = await list('favorites=true', bruno).expect(200);
      expect(forBruno.body.items).toEqual([]);
    });

    it('personal tiers are per goal: patching one goal keeps the other', async () => {
      const id = ids.get('t-bench')!;
      const prefs = () => as(ana, http().patch(`/api/v1/exercises/${id}/prefs`));

      await prefs()
        .send({ personalTiers: { hypertrophy: 'A', powerlifting: 'S' } })
        .expect(200);
      const res = await prefs()
        .send({ personalTiers: { powerlifting: null } })
        .expect(200);
      expect(res.body.personalTiers).toEqual({ hypertrophy: 'A', powerlifting: null });

      // Restore: later tests expect bench without personal tiers.
      await prefs()
        .send({ personalTiers: { hypertrophy: null } })
        .expect(200);
    });

    it('rejects an invalid tier and the old single `personalTier` field', async () => {
      const id = ids.get('t-bench')!;
      await as(ana, http().patch(`/api/v1/exercises/${id}/prefs`))
        .send({ personalTiers: { hypertrophy: 'X' } })
        .expect(400);
      await as(ana, http().patch(`/api/v1/exercises/${id}/prefs`))
        .send({ personalTiers: { cardio: 'S' } })
        .expect(400);
      await as(ana, http().patch(`/api/v1/exercises/${id}/prefs`))
        .send({ personalTier: 'S' })
        .expect(400);
    });
  });

  describe('GET /exercises/tier-list', () => {
    const names = (list: { name: string }[]) => list.map((i) => i.name);

    it('groups by global tier for a goal and muscle', async () => {
      const res = await as(
        ana,
        http().get('/api/v1/exercises/tier-list?goal=hypertrophy&muscle=quads'),
      ).expect(200);
      expect(res.body.goal).toBe('hypertrophy');
      expect(res.body.muscle).toBe('quads');
      expect(names(res.body.tiers.S)).toEqual(['Sentadilla búlgara', 'Sentadilla trasera']);
      expect(names(res.body.tiers.A)).toEqual(['Extensión de cuádriceps']);
      expect(res.body.tiers.B).toEqual([]);
      expect(res.body.tiers.C).toEqual([]);
    });

    it('puts exercises without a tier for that goal in `unranked`', async () => {
      const res = await as(
        ana,
        http().get('/api/v1/exercises/tier-list?goal=hypertrophy&muscle=rear_delts'),
      ).expect(200);
      expect(names(res.body.unranked)).toEqual(['Face pull']);
    });

    it('source=personal applies the caller’s personal tiers', async () => {
      // ana set leg extension to S personally for hypertrophy (previous block).
      const res = await as(
        ana,
        http().get('/api/v1/exercises/tier-list?goal=hypertrophy&muscle=quads&source=personal'),
      ).expect(200);
      expect(names(res.body.tiers.S)).toEqual([
        'Extensión de cuádriceps',
        'Sentadilla búlgara',
        'Sentadilla trasera',
      ]);
      expect(res.body.tiers.A).toEqual([]);
    });

    it('source=personal only applies the personal tier of the requested goal', async () => {
      // Leg extension is personal S for hypertrophy only: powerlifting keeps the global tier.
      const personal = await as(
        ana,
        http().get('/api/v1/exercises/tier-list?goal=powerlifting&muscle=quads&source=personal'),
      ).expect(200);
      const global = await as(
        ana,
        http().get('/api/v1/exercises/tier-list?goal=powerlifting&muscle=quads&source=global'),
      ).expect(200);
      expect(personal.body.tiers).toEqual(global.body.tiers);
    });

    it('requires a valid goal', async () => {
      await as(ana, http().get('/api/v1/exercises/tier-list')).expect(400);
    });
  });

  describe('custom exercises', () => {
    let customId: string;

    it('creates a private custom exercise, searchable and shown in every language', async () => {
      const res = await as(ana, http().post('/api/v1/exercises'))
        .send({
          name: 'Remo Kayak',
          primaryMuscle: 'lats',
          equipment: 'cable',
          mechanic: 'compound',
          tags: ['unilateral'],
        })
        .expect(201);
      customId = res.body.id;
      expect(res.body).toMatchObject({
        isCustom: true,
        isGlobal: false,
        slug: null,
        tiers: { hypertrophy: null, powerlifting: null },
      });

      const inEnglish = await list('custom=true', ana, 'en').expect(200);
      expect(inEnglish.body.items.map((i: { name: string }) => i.name)).toEqual(['Remo Kayak']);
      expect(slugsOf((await list('q=kayak').expect(200)).body)).toEqual(['Remo Kayak']);

      // Invisible to others, including by id.
      expect((await list('q=kayak', bruno).expect(200)).body.items).toEqual([]);
      await as(bruno, http().get(`/api/v1/exercises/${customId}`)).expect(404);
      await as(bruno, http().patch(`/api/v1/exercises/${customId}`))
        .send({ name: 'hack' })
        .expect(404);
    });

    it('validates tags and refuses to null required fields', async () => {
      const badTag = await as(ana, http().post('/api/v1/exercises'))
        .send({
          name: 'X',
          primaryMuscle: 'lats',
          equipment: 'cable',
          mechanic: 'compound',
          tags: ['nope'],
        })
        .expect(400);
      expect(badTag.body).toMatchObject({ code: 'TAG_NOT_FOUND', details: { missing: ['nope'] } });

      await as(ana, http().patch(`/api/v1/exercises/${customId}`))
        .send({ name: null })
        .expect(400);
      const renamed = await as(ana, http().patch(`/api/v1/exercises/${customId}`))
        .send({ name: 'Remo Kayak polea', description: 'De pie' })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'Remo Kayak polea', description: 'De pie' });
    });

    it('cannot edit global exercises through the user endpoints', async () => {
      await as(ana, http().patch(`/api/v1/exercises/${ids.get('t-bench')!}`))
        .send({ name: 'Mine' })
        .expect(404);
      await as(ana, http().delete(`/api/v1/exercises/${ids.get('t-bench')!}`)).expect(404);
    });

    it('rejects image URLs that did not come from our upload signatures', async () => {
      const res = await as(ana, http().patch(`/api/v1/exercises/${customId}`))
        .send({ imageUrl: 'https://example.com/pixel.gif' })
        .expect(503); // media not configured in tests → can't validate → refuse
      expect(res.body.code).toBe('MEDIA_NOT_CONFIGURED');
    });

    it('enforces the Free plan limit (10) and frees a slot on delete', async () => {
      // ana already has 1.
      for (let i = 2; i <= 10; i++) {
        await as(ana, http().post('/api/v1/exercises'))
          .send({
            name: `Custom ${i}`,
            primaryMuscle: 'biceps',
            equipment: 'cable',
            mechanic: 'isolation',
          })
          .expect(201);
      }
      const blocked = await as(ana, http().post('/api/v1/exercises'), 'en')
        .send({
          name: 'Custom 11',
          primaryMuscle: 'biceps',
          equipment: 'cable',
          mechanic: 'isolation',
        })
        .expect(403);
      expect(blocked.body).toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
        message: 'You have reached your plan limit (10).',
        details: { resource: 'customExercises', limit: 10, current: 10 },
      });

      await as(ana, http().delete(`/api/v1/exercises/${customId}`)).expect(204);
      await as(ana, http().post('/api/v1/exercises'))
        .send({
          name: 'Custom 11',
          primaryMuscle: 'biceps',
          equipment: 'cable',
          mechanic: 'isolation',
        })
        .expect(201);
    });
  });

  describe('admin', () => {
    it('returns full translation maps and only global exercises', async () => {
      const res = await as(
        admin,
        http().get('/api/v1/admin/exercises?muscle=chest&limit=1'),
      ).expect(200);
      expect(res.body.meta.total).toBe(4);
      expect(res.body.items[0].name).toEqual({ es: 'Aperturas en polea', en: 'Cable fly' });

      const all = await as(admin, http().get('/api/v1/admin/exercises?limit=100')).expect(200);
      expect(all.body.items.every((e: { slug: string | null }) => e.slug !== null)).toBe(true);
    });

    it('bulk-assigns tiers (omitted goal unchanged, null unranks) and reports unknown ids', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      const res = await as(admin, http().patch('/api/v1/admin/exercises/tiers'))
        .send({
          items: [
            { id: ids.get('t-face-pull'), hypertrophy: 'B' },
            { id: ids.get('t-pec-deck'), powerlifting: null },
            { id: unknown, hypertrophy: 'S' },
          ],
        })
        .expect(200);
      expect(res.body).toEqual({ updated: 2, notFound: [unknown] });

      const face = await as(
        admin,
        http().get(`/api/v1/admin/exercises/${ids.get('t-face-pull')!}`),
      ).expect(200);
      expect(face.body.tiers).toEqual({ hypertrophy: 'B', powerlifting: 'B' });
      const pec = await as(
        admin,
        http().get(`/api/v1/admin/exercises/${ids.get('t-pec-deck')!}`),
      ).expect(200);
      expect(pec.body.tiers).toEqual({ hypertrophy: 'A', powerlifting: null });
    });

    it('creates global exercises; slugs stay reserved after deletion', async () => {
      const body = {
        slug: 't-new',
        name: { es: 'Nuevo', en: 'New' },
        primaryMuscle: 'calves',
        equipment: 'machine',
        mechanic: 'isolation',
        tiers: { hypertrophy: 'B', powerlifting: null },
      };
      const created = await as(admin, http().post('/api/v1/admin/exercises'))
        .send(body)
        .expect(201);
      await as(admin, http().delete(`/api/v1/admin/exercises/${created.body.id}`)).expect(204);
      const again = await as(admin, http().post('/api/v1/admin/exercises')).send(body).expect(409);
      expect(again.body.code).toBe('EXERCISE_SLUG_TAKEN');

      // The seeder doesn't resurrect it either.
      const report = await app.get(ExercisesSeeder).run(
        {
          tags: [],
          exercises: [
            { ...body, secondaryMuscles: [], category: 'accessory', tags: [] } as SeedExercise,
          ],
        },
        { update: true },
      );
      expect(report.exercises).toEqual({ inserted: 0, updated: 0, skipped: 1 });
    });

    it('tag deletion removes the tag from exercises', async () => {
      const tags = await as(admin, http().get('/api/v1/admin/exercise-tags')).expect(200);
      const unilateral = (tags.body as { id: string; slug: string }[]).find(
        (t) => t.slug === 'unilateral',
      )!;
      await as(admin, http().delete(`/api/v1/admin/exercise-tags/${unilateral.id}`)).expect(204);

      expect((await list('tag=unilateral').expect(200)).body.items).toEqual([]);
      const publicTags = await http()
        .get('/api/v1/exercise-tags')
        .set('Accept-Language', 'en')
        .expect(200);
      expect(publicTags.body).toEqual([{ slug: 'basic', name: 'Staple' }]);
    });

    it('non-admins are rejected', async () => {
      await as(ana, http().get('/api/v1/admin/exercises')).expect(403);
    });
  });

  describe('execution instructions', () => {
    const withSteps = (): SeedFile => ({
      ...FIXTURE,
      exercises: FIXTURE.exercises.map((e) => ({
        ...e,
        instructions: { es: 'Paso 1\nPaso 2\nPaso 3', en: 'Step 1\nStep 2\nStep 3' },
      })),
    });

    it('seeding fills EMPTY instructions only (admin text wins); a second run changes nothing', async () => {
      const db = app.get<Connection>(getConnectionToken());
      await db
        .collection('exercises')
        .updateOne({ slug: 't-bench' }, { $set: { instructions: { es: 'Del admin' } } });

      const report = await app.get(ExercisesSeeder).run(withSteps(), { update: false });
      expect(report.instructionsFilled).toBe(FIXTURE.exercises.length - 1);
      expect(report.exercises.updated).toBe(0);

      const bench = await as(ana, http().get(`/api/v1/exercises/${ids.get('t-bench')}`)).expect(
        200,
      );
      expect(bench.body.instructions).toBe('Del admin');
      const legExt = await as(
        ana,
        http().get(`/api/v1/exercises/${ids.get('t-leg-ext')}`),
        'en',
      ).expect(200);
      expect(legExt.body.instructions).toBe('Step 1\nStep 2\nStep 3');

      const again = await app.get(ExercisesSeeder).run(withSteps(), { update: false });
      expect(again.instructionsFilled).toBe(0);
    });

    it('withText=true adds the localized texts to the listing; the plain listing stays light', async () => {
      type Item = { slug: string; description?: string; instructions?: string };
      const full = await list('withText=true&limit=100', ana, 'en').expect(200);
      const item = (full.body as { items: Item[] }).items.find((i) => i.slug === 't-leg-ext')!;
      expect(item.instructions).toBe('Step 1\nStep 2\nStep 3');
      expect(typeof item.description).toBe('string');

      const plain = await list('limit=100').expect(200);
      for (const i of (plain.body as { items: Item[] }).items) {
        expect(i).not.toHaveProperty('instructions');
        expect(i).not.toHaveProperty('description');
      }
    });
  });
});
