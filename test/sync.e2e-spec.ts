import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ExercisesSeeder, loadSeedFile } from '../src/modules/exercises/exercises.seeder';
import { PULL_SAFETY_MARGIN_MS } from '../src/modules/sync/sync.service';
import { createTestApp, uniqueEmail } from './utils/create-test-app';

/** Pull only returns writes older than the safety margin; wait it out before pulling. */
const settle = () => new Promise((resolve) => setTimeout(resolve, PULL_SAFETY_MARGIN_MS + 150));

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3_600_000;

describe('Sync (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let ana: string;
  let other: string;
  const ex = new Map<string, string>();
  const eventNames: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', 'en');
  const push = (token: string, changes: object[]) =>
    as(token, http().post('/api/v1/sync/push')).send({ changes }).expect(200);
  const pull = (token: string, since?: string) =>
    as(
      token,
      http().get(`/api/v1/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`),
    ).expect(200);

  const register = async (prefix: string) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(prefix), password: 'secret-pass-1' })
        .expect(201)
    ).body as { user: { id: string }; tokens: { accessToken: string } };

  const workoutDoc = (id: string, updatedAt: string, name: string, extra: object = {}) => ({
    id,
    updatedAt,
    name,
    startedAt: iso(2 * HOUR),
    finishedAt: iso(HOUR),
    exercises: [
      {
        id: randomUUID(),
        exerciseId: ex.get('barbell-back-squat'),
        sets: [{ id: randomUUID(), type: 'normal', weightKg: 100, reps: 5, completed: true }],
      },
    ],
    ...extra,
  });

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<Connection>(getConnectionToken());
    await app.get(ExercisesSeeder).run(loadSeedFile(), { update: false });
    for (const doc of await db.collection('exercises').find({ isGlobal: true }).toArray()) {
      ex.set(doc.slug as string, doc._id as unknown as string);
    }
    app.get(EventEmitter2).onAny((name: string | string[]) => void eventNames.push(String(name)));
    ana = (await register('ana')).tokens.accessToken;
    other = (await register('other')).tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('push', () => {
    it('is idempotent: replaying the same change applies once', async () => {
      const id = randomUUID();
      const change = {
        collection: 'workouts',
        op: 'upsert',
        doc: workoutDoc(id, iso(10 * HOUR), 'Pierna'),
      };
      eventNames.length = 0;

      const first = await push(ana, [change]);
      expect(first.body.results).toEqual([
        { index: 0, collection: 'workouts', id, status: 'applied' },
      ]);
      const stored = await db.collection('workouts').findOne({ _id: id as never });

      const replay = await push(ana, [change]);
      expect(replay.body.results[0].status).toBe('applied');
      expect(await db.collection('workouts').countDocuments({ _id: id as never })).toBe(1);
      const after = await db.collection('workouts').findOne({ _id: id as never });
      expect(after!.serverUpdatedAt).toEqual(stored!.serverUpdatedAt); // no second write
      expect(after!.volumeKg).toBe(500); // computed server-side
      expect(eventNames).toEqual(['workout.finished']); // emitted once
    });

    it('rounds weights converted from lb instead of rejecting the document', async () => {
      const id = randomUUID();
      const doc = workoutDoc(id, iso(HOUR), 'imperial');
      doc.exercises[0].sets[0].weightKg = 225 * 0.45359237; // 102.05828325
      const metricId = randomUUID();

      const res = await push(ana, [
        { collection: 'workouts', op: 'upsert', doc },
        {
          collection: 'body_metrics',
          op: 'upsert',
          doc: { id: metricId, updatedAt: iso(HOUR), measuredAt: iso(HOUR), weightKg: 72.5747792 },
        },
      ]);

      expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
        'applied',
        'applied',
      ]);
      const stored = await db.collection('workouts').findOne({ _id: id as never });
      expect(stored!.exercises[0].sets[0].weightKg).toBe(102.058);
      const metric = await db.collection('body_metrics').findOne({ _id: metricId as never });
      expect(metric!.weightKg).toBe(72.575);
    });

    it('last write wins: an older version is ignored, a newer one applied', async () => {
      const id = randomUUID();
      await push(ana, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(id, iso(1 * HOUR), 'phone v2') },
      ]);

      const older = await push(ana, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(id, iso(3 * HOUR), 'tablet v1') },
      ]);
      expect(older.body.results[0]).toMatchObject({ id, status: 'ignored_older' });
      expect((await db.collection('workouts').findOne({ _id: id as never }))!.name).toBe(
        'phone v2',
      );

      const newerAt = iso(1000);
      const newer = await push(ana, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(id, newerAt, 'tablet v3') },
      ]);
      expect(newer.body.results[0].status).toBe('applied');
      const stored = await db.collection('workouts').findOne({ _id: id as never });
      expect(stored!.name).toBe('tablet v3');
      // The CLIENT's updatedAt is stored as-is (Mongoose timestamps must not overwrite it).
      expect(stored!.updatedAt).toEqual(new Date(newerAt));
    });

    it('a stale delete loses against a newer edit (and vice versa)', async () => {
      const id = randomUUID();
      await push(ana, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(id, iso(HOUR), 'kept') },
      ]);
      const staleDelete = await push(ana, [
        { collection: 'workouts', op: 'delete', doc: { id, updatedAt: iso(2 * HOUR) } },
      ]);
      expect(staleDelete.body.results[0].status).toBe('ignored_older');
      expect((await db.collection('workouts').findOne({ _id: id as never }))!.deletedAt).toBeNull();
    });

    it('each change succeeds or fails on its own', async () => {
      const ok1 = randomUUID();
      const ok2 = randomUUID();
      const res = await push(ana, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(ok1, iso(HOUR), 'a') },
        {
          collection: 'workouts',
          op: 'upsert',
          doc: workoutDoc(randomUUID(), iso(HOUR), 'bad', { startedAt: 'nope' }),
        },
        { collection: 'workouts', op: 'upsert', doc: { id: 'not-a-uuid', updatedAt: iso(HOUR) } },
        {
          collection: 'body_metrics',
          op: 'upsert',
          doc: { id: randomUUID(), updatedAt: iso(HOUR), measuredAt: iso(HOUR) },
        },
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(ok2, iso(HOUR), 'b') },
      ]);
      expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
        'applied',
        'error',
        'error',
        'error',
        'applied',
      ]);
      expect(res.body.results[1].error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'The submitted data is not valid.',
        details: [expect.objectContaining({ field: 'doc.startedAt' })],
      });
      expect(res.body.results[2].error.details).toEqual([
        { field: 'doc.id', constraints: ['isUuid'] },
      ]);
      expect(res.body.results[3].error.details).toEqual([
        { field: 'doc', constraints: ['atLeastOneMeasurement'] },
      ]);
    });

    it('rejects a client clock far in the future (it would win every conflict forever)', async () => {
      const res = await push(ana, [
        {
          collection: 'workouts',
          op: 'upsert',
          doc: workoutDoc(randomUUID(), new Date(Date.now() + 24 * HOUR).toISOString(), 'x'),
        },
      ]);
      expect(res.body.results[0].error.code).toBe('CLOCK_SKEW');
    });

    it('cannot write over another user’s document', async () => {
      const id = randomUUID();
      await push(ana, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(id, iso(HOUR), 'mine') },
      ]);
      const res = await push(other, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(id, iso(1000), 'stolen') },
      ]);
      expect(res.body.results[0]).toMatchObject({ status: 'error', error: { code: 'FORBIDDEN' } });
      expect((await db.collection('workouts').findOne({ _id: id as never }))!.name).toBe('mine');
    });

    it('exercise prefs created on two devices converge on one document (keyed by exercise)', async () => {
      const exerciseId = ex.get('pull-up');
      const fromPhone = randomUUID();
      const fromTablet = randomUUID();
      await push(ana, [
        {
          collection: 'user_exercise_prefs',
          op: 'upsert',
          doc: { id: fromPhone, updatedAt: iso(2 * HOUR), exerciseId, isFavorite: true },
        },
      ]);
      const res = await push(ana, [
        {
          collection: 'user_exercise_prefs',
          op: 'upsert',
          doc: {
            id: fromTablet,
            updatedAt: iso(HOUR),
            exerciseId,
            isFavorite: true,
            personalTiers: { hypertrophy: 'S' },
          },
        },
      ]);
      expect(res.body.results[0]).toMatchObject({ id: fromPhone, status: 'applied' });
      expect(await db.collection('user_exercise_prefs').countDocuments({ exerciseId })).toBe(1);

      const list = await as(ana, http().get('/api/v1/exercises?favorites=true')).expect(200);
      expect(list.body.items[0]).toMatchObject({
        isFavorite: true,
        personalTiers: { hypertrophy: 'S', powerlifting: null },
      });
    });

    it('a device that only sends one goal’s personal tier keeps the other goal', async () => {
      const exerciseId = ex.get('pull-up');
      const res = await push(ana, [
        {
          collection: 'user_exercise_prefs',
          op: 'upsert',
          doc: {
            id: randomUUID(),
            updatedAt: iso(HOUR / 2), // newer than the last write (iso(HOUR)): LWW applies it
            exerciseId,
            personalTiers: { powerlifting: 'B' },
          },
        },
      ]);
      expect(res.body.results[0]).toMatchObject({ status: 'applied' });
      const pref = await db.collection('user_exercise_prefs').findOne({ exerciseId });
      // hypertrophy: 'S' came from the previous test; favorite untouched too.
      expect(pref).toMatchObject({
        isFavorite: true,
        personalTiers: { hypertrophy: 'S', powerlifting: 'B' },
      });
    });

    it('routines follow the same plan rules as REST (Free: 3)', async () => {
      const routine = (name: string) => ({
        collection: 'routines',
        op: 'upsert',
        doc: {
          id: randomUUID(),
          updatedAt: iso(HOUR),
          name,
          exercises: [
            { exerciseId: ex.get('pull-up'), sets: [{ type: 'normal', repsMin: 5, repsMax: 8 }] },
          ],
        },
      });
      const res = await push(other, [routine('1'), routine('2'), routine('3'), routine('4')]);
      expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
        'applied',
        'applied',
        'applied',
        'error',
      ]);
      expect(res.body.results[3].error.code).toBe('PLAN_LIMIT_REACHED');

      // Progression rules are Premium (checked before the routine limit).
      const withRule = routine('rule');
      (withRule.doc.exercises[0] as Record<string, unknown>).progression = {
        type: 'double_progression',
      };
      const premiumOnly = await push(other, [withRule]);
      expect(premiumOnly.body.results[0].error.code).toBe('PLAN_FEATURE_REQUIRED');
    });
  });

  describe('pull', () => {
    let user: string;
    let cursor: string;
    const workoutId = randomUUID();

    beforeAll(async () => {
      user = (await register('puller')).tokens.accessToken;
    });

    it('full sync returns the user’s documents (only theirs) and a cursor', async () => {
      await push(user, [
        { collection: 'workouts', op: 'upsert', doc: workoutDoc(workoutId, iso(HOUR), 'synced') },
        {
          collection: 'body_metrics',
          op: 'upsert',
          doc: { id: randomUUID(), updatedAt: iso(HOUR), measuredAt: iso(HOUR), weightKg: 80.5 },
        },
      ]);
      await as(user, http().post('/api/v1/exercises'))
        .send({
          name: 'Mi ejercicio',
          primaryMuscle: 'chest',
          equipment: 'cable',
          mechanic: 'isolation',
        })
        .expect(201);
      await settle();

      const res = await pull(user);
      cursor = res.body.serverTime;
      expect(Object.keys(res.body.changes).sort()).toEqual(
        [
          'body_metrics',
          'exercises',
          'programs',
          'routines',
          'user_exercise_prefs',
          'workouts',
        ].sort(),
      );
      expect(res.body.changes.workouts).toHaveLength(1);
      expect(res.body.changes.workouts[0]).toMatchObject({
        id: workoutId,
        name: 'synced',
        deletedAt: null,
      });
      expect(res.body.changes.workouts[0]).not.toHaveProperty('_id');
      expect(res.body.changes.workouts[0]).not.toHaveProperty('userId');
      expect(res.body.changes.body_metrics[0]).toMatchObject({ weightKg: 80.5 });
      // Only the user's custom exercises, never the global catalog.
      expect(res.body.changes.exercises.map((e: { name: { es: string } }) => e.name.es)).toEqual([
        'Mi ejercicio',
      ]);
    });

    it('incremental pull includes deletions', async () => {
      await push(user, [
        { collection: 'workouts', op: 'delete', doc: { id: workoutId, updatedAt: iso(1000) } },
      ]);
      await settle();

      const res = await pull(user, cursor);
      expect(res.body.changes.workouts).toEqual([
        expect.objectContaining({ id: workoutId, deletedAt: expect.any(String) }),
      ]);
      expect(res.body.changes.body_metrics).toEqual([]); // unchanged since the cursor
      cursor = res.body.serverTime;
    });

    it('an offline edit pushed late is still delivered (cursor = server write time, not updatedAt)', async () => {
      const lateId = randomUUID();
      // Edited 5 hours ago on a phone without signal, pushed only now.
      await push(user, [
        {
          collection: 'workouts',
          op: 'upsert',
          doc: workoutDoc(lateId, iso(5 * HOUR), 'offline edit'),
        },
      ]);
      await settle();

      const res = await pull(user, cursor);
      expect(res.body.changes.workouts.map((w: { id: string }) => w.id)).toEqual([lateId]);
      expect(new Date(res.body.changes.workouts[0].updatedAt).getTime()).toBeLessThan(
        new Date(cursor).getTime(),
      );
    });

    it('REST writes show up in pull too', async () => {
      const before = (await pull(user)).body.serverTime;
      const created = await as(user, http().post('/api/v1/workouts'))
        .send({ ...workoutDoc(randomUUID(), iso(0), 'via REST'), updatedAt: undefined })
        .expect(201);
      await settle();
      const res = await pull(user, before);
      expect(res.body.changes.workouts.map((w: { id: string }) => w.id)).toEqual([created.body.id]);
    });
  });
});
