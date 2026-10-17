import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Env } from '../src/config/env.schema';
import { ExercisesSeeder, loadSeedFile } from '../src/modules/exercises/exercises.seeder';
import { MediaService } from '../src/modules/media/media.service';
import { PULL_SAFETY_MARGIN_MS } from '../src/modules/sync/sync.service';
import { createTestApp, createTestUser } from './utils/create-test-app';

/**
 * Per-user data isolation (SPEC: "cada usuario solo accede a sus datos").
 *
 * Bob owns one of everything (custom exercise, prefs, routine, active program, workout → PRs and
 * stats, body metric, progress photo), each carrying MARKER where it has free text. Alice and
 * Carol own nothing. Then every user endpoint is hit:
 * - lists/aggregates: Alice must get exactly what empty Carol gets, and Bob must get something
 *   else (positive control — otherwise the check would prove nothing). Responses with timestamps
 *   or the caller's identity are checked for Bob's traces instead.
 * - by id: Bob's documents are 404 for Alice on every verb (403 would reveal they exist).
 * - references and id takeover (REST + sync) are rejected, and Bob's documents stay untouched.
 */
const MARKER = 'BOB-SECRET-7f3a';
const settle = () => new Promise((resolve) => setTimeout(resolve, PULL_SAFETY_MARGIN_MS + 150));

/** Real MediaService with fake Cloudinary credentials: photo URLs can be signed offline. */
const media = new MediaService({
  get: (key: keyof Env) =>
    ({
      CLOUDINARY_CLOUD_NAME: 'demo-cloud',
      CLOUDINARY_API_KEY: '123',
      CLOUDINARY_API_SECRET: 'secret',
      CLOUDINARY_FOLDER: 'gymapp',
      NODE_ENV: 'test',
      MEDIA_MAX_IMAGE_BYTES: 5_000_000,
    })[key as string],
} as unknown as ConfigService<Env, true>);
jest.spyOn(media, 'destroyPrivateImage').mockResolvedValue(undefined);

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
type Key = 'exercise' | 'routine' | 'slot' | 'program' | 'workout' | 'metric' | 'photo';

describe('Per-user data isolation (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let alice: string;
  let bob: string;
  let carol: string;
  let bench: string;
  const ids = {} as Record<Key, string>;
  const bobSnapshot = new Map<Key, unknown>();
  const OWNED: [collection: string, key: Key][] = [
    ['exercises', 'exercise'],
    ['routines', 'routine'],
    ['programs', 'program'],
    ['workouts', 'workout'],
    ['body_metrics', 'metric'],
    ['progress_photos', 'photo'],
  ];

  const http = () => request(app.getHttpServer());
  const call = (token: string, method: Method, path: string) =>
    http()
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'es');
  /** `{exercise}`, `{bench}`… → ids. */
  const fill = (text: string) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => (key === 'bench' ? bench : ids[key as Key]));

  const workoutBody = (extra: object = {}) => ({
    id: randomUUID(),
    name: 'Torso',
    startedAt: '2026-01-10T10:00:00.000Z',
    finishedAt: '2026-01-10T11:00:00.000Z',
    exercises: [
      {
        id: randomUUID(),
        exerciseId: bench,
        sets: [{ id: randomUUID(), type: 'normal', weightKg: 100, reps: 5, completed: true }],
      },
    ],
    ...extra,
  });

  beforeAll(async () => {
    ({ app } = await createTestApp((builder) =>
      builder.overrideProvider(MediaService).useValue(media),
    ));
    db = app.get<Connection>(getConnectionToken());
    await app.get(ExercisesSeeder).run(loadSeedFile(), { update: false });
    bench = String(
      (await db.collection('exercises').findOne({ slug: 'barbell-bench-press' }))!._id,
    );

    // Premium for everyone: plan gating must not hide a leak behind a 403.
    alice = (await createTestUser(app, { premium: true })).token;
    carol = (await createTestUser(app, { premium: true })).token;
    const bobUser = await createTestUser(app, { premium: true });
    bob = bobUser.token;

    const exercise = await call(bob, 'post', '/exercises')
      .send({
        name: `${MARKER} curl`,
        primaryMuscle: 'biceps',
        equipment: 'cable',
        mechanic: 'isolation',
      })
      .expect(201);
    ids.exercise = (exercise.body as { id: string }).id;
    await call(bob, 'patch', `/exercises/${bench}/prefs`)
      .send({ isFavorite: true, personalTier: 'C' })
      .expect(200);

    const routine = await call(bob, 'post', '/routines')
      .send({
        name: `${MARKER} routine`,
        exercises: [
          { exerciseId: bench, sets: [{ type: 'normal', repsMin: 5, repsMax: 5 }] },
          { exerciseId: ids.exercise, sets: [{ type: 'normal', repsMin: 10, repsMax: 12 }] },
        ],
      })
      .expect(201);
    ids.routine = (routine.body as { id: string }).id;
    ids.slot = (routine.body as { exercises: { id: string }[] }).exercises[0]!.id;

    const program = await call(bob, 'post', '/programs')
      .send({
        name: `${MARKER} program`,
        durationWeeks: 1,
        weeks: [{ days: [{ weekday: 1, routineId: ids.routine }] }],
      })
      .expect(201);
    ids.program = (program.body as { id: string }).id;
    await call(bob, 'post', `/programs/${ids.program}/activate`)
      .send({ startDate: '2026-01-05' })
      .expect(200);

    const workout = workoutBody({
      name: `${MARKER} workout`,
      routineId: ids.routine,
      programId: ids.program,
    });
    workout.exercises.push({
      id: randomUUID(),
      exerciseId: ids.exercise,
      sets: [{ id: randomUUID(), type: 'normal', weightKg: 20, reps: 10, completed: true }],
    });
    await call(bob, 'post', '/workouts').send(workout).expect(201);
    ids.workout = workout.id;

    const metric = await call(bob, 'post', '/body-metrics')
      .send({ measuredAt: '2026-01-10T08:00:00.000Z', weightKg: 81.5, notes: MARKER })
      .expect(201);
    ids.metric = (metric.body as { id: string }).id;

    // Uploading needs Cloudinary; the stored record is what matters for isolation.
    ids.photo = randomUUID();
    const now = new Date();
    await db.collection('progress_photos').insertOne({
      _id: ids.photo as never,
      userId: bobUser.id,
      view: 'front',
      takenAt: new Date('2026-01-10T08:00:00.000Z'),
      publicId: `gymapp/test/users/${bobUser.id}/progress/${ids.photo}`,
      format: 'jpg',
      url: `https://res.cloudinary.com/demo-cloud/image/authenticated/gymapp/test/users/${bobUser.id}/progress/${ids.photo}.jpg`,
      notes: MARKER,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      serverUpdatedAt: now,
    });

    for (const [collection, key] of OWNED) {
      bobSnapshot.set(key, await db.collection(collection).findOne({ _id: ids[key] as never }));
    }
    await settle(); // Bob's writes enter the sync pull window
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('lists and aggregates: Alice sees exactly what a user with no data sees', () => {
    const RANGE = 'from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z';
    const snapshot = async (token: string, path: string) => {
      const res = await call(token, 'get', fill(path));
      // The window ends "now" when no `to` applies (e.g. the current year's frequency).
      return { status: res.status, body: res.text.replace(/"to":"[^"]+"/g, '"to":"<now>"') };
    };

    it.each([
      ['/exercises?limit=100&custom=true'],
      [`/exercises?limit=100&q=${MARKER}`],
      ['/exercises?limit=100&favorites=true'],
      ['/exercises/tier-list?goal=hypertrophy&source=personal&muscle=biceps'],
      ['/exercises/tier-list?goal=hypertrophy&source=personal&muscle=chest'],
      ['/exercises/{bench}'],
      ['/routines'],
      ['/programs'],
      ['/programs/active/today?date=2026-01-12'],
      [`/workouts?${RANGE}`],
      ['/exercises/{bench}/last-performance'],
      ['/exercises/{bench}/history'],
      ['/records'],
      ['/exercises/{bench}/records'],
      [`/stats/exercise/{bench}?${RANGE}`],
      ['/stats/frequency?year=2026'],
      [`/stats/muscle-volume?${RANGE}`],
      [`/stats/powerlifting-total?${RANGE}`],
      ['/body-metrics'],
      [`/body-metrics/series?metric=weightKg&${RANGE}`],
      ['/progress-photos'],
      [`/progress-photos/compare?view=front&${RANGE}`],
    ])('GET %s', async (path) => {
      const empty = await snapshot(carol, path);
      expect([200, 404]).toContain(empty.status);
      // Positive control: this endpoint does expose Bob's data to Bob.
      expect(await snapshot(bob, path)).not.toEqual(empty);
      expect(await snapshot(alice, path)).toEqual(empty);
    });

    const bobTraces = () => [
      MARKER,
      ...Object.values(ids),
      '81.5', // Bob's weight
    ];

    // Contain timestamps or the caller's identity: compared by Bob's traces instead.
    // (Export is rate limited to 5/min per IP: 4 calls here.)
    it.each([['/sync/pull'], ['/export?format=json'], ['/export?format=csv&dataset=workouts']])(
      'GET %s',
      async (path) => {
        const bobRes = await call(bob, 'get', path).expect(200);
        expect(bobTraces().some((trace) => bobRes.text.includes(trace))).toBe(true);
        const aliceRes = await call(alice, 'get', path).expect(200);
        for (const trace of bobTraces()) expect(aliceRes.text).not.toContain(trace);
      },
    );

    it('GET /users/me is the caller', async () => {
      const res = await call(alice, 'get', '/users/me').expect(200);
      for (const trace of bobTraces()) expect(res.text).not.toContain(trace);
    });
  });

  describe("another user's documents are 404 by id (403 would reveal they exist)", () => {
    it.each<[Method, string, object | null]>([
      ['get', '/exercises/{exercise}', null],
      ['patch', '/exercises/{exercise}', { name: 'hijacked' }],
      ['delete', '/exercises/{exercise}', null],
      ['patch', '/exercises/{exercise}/prefs', { isFavorite: true }],
      ['get', '/routines/{routine}', null],
      ['patch', '/routines/{routine}', { name: 'hijacked' }],
      ['delete', '/routines/{routine}', null],
      ['post', '/routines/{routine}/duplicate', {}],
      ['post', '/routines/{routine}/archive', {}],
      ['post', '/routines/{routine}/unarchive', {}],
      ['put', '/routines/{routine}/exercises/order', { itemIds: ['{slot}'] }],
      ['get', '/programs/{program}', null],
      ['patch', '/programs/{program}', { name: 'hijacked' }],
      ['delete', '/programs/{program}', null],
      ['post', '/programs/{program}/activate', {}],
      ['post', '/programs/{program}/deactivate', {}],
      ['post', '/programs/{program}/complete', {}],
      ['get', '/programs/active/today?programId={program}&date=2026-01-12', null],
      ['get', '/stats/program-adherence/{program}', null],
      ['get', '/workouts/{workout}', null],
      ['patch', '/workouts/{workout}', { name: 'hijacked' }],
      ['delete', '/workouts/{workout}', null],
      ['get', '/body-metrics/{metric}', null],
      ['patch', '/body-metrics/{metric}', { weightKg: 50 }],
      ['delete', '/body-metrics/{metric}', null],
      ['delete', '/progress-photos/{photo}', null],
    ])('%s %s', async (method, path, body) => {
      const req = call(alice, method, fill(path));
      const res = await (body ? req.send(JSON.parse(fill(JSON.stringify(body))) as object) : req);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain(MARKER);
    });
  });

  describe("another user's documents can't be referenced", () => {
    it('routine with their custom exercise → 400 EXERCISE_NOT_FOUND', async () => {
      const res = await call(alice, 'post', '/routines')
        .send({
          name: 'Mine',
          exercises: [
            { exerciseId: ids.exercise, sets: [{ type: 'normal', repsMin: 5, repsMax: 5 }] },
          ],
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'EXERCISE_NOT_FOUND' });
    });

    it('program with their routine → 400 ROUTINE_NOT_FOUND', async () => {
      const res = await call(alice, 'post', '/programs')
        .send({
          name: 'Mine',
          durationWeeks: 1,
          weeks: [{ days: [{ weekday: 1, routineId: ids.routine }] }],
        })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'ROUTINE_NOT_FOUND' });
    });

    it.each([
      ['routineId', 'routine', 'ROUTINE_NOT_FOUND'],
      ['programId', 'program', 'PROGRAM_NOT_FOUND'],
    ] as const)('workout with their %s → 400', async (field, key, code) => {
      const res = await call(alice, 'post', '/workouts')
        .send(workoutBody({ [field]: ids[key] }))
        .expect(400);
      expect(res.body).toMatchObject({ code });
    });

    it('workout with their custom exercise → 400 EXERCISE_NOT_FOUND', async () => {
      const body = workoutBody();
      body.exercises[0]!.exerciseId = ids.exercise;
      const res = await call(alice, 'post', '/workouts').send(body).expect(400);
      expect(res.body).toMatchObject({ code: 'EXERCISE_NOT_FOUND' });
    });
  });

  describe("another user's ids can't be taken over", () => {
    it('REST idempotent creates with their id → 409, nothing echoed back', async () => {
      const workout = await call(alice, 'post', '/workouts')
        .send(workoutBody({ id: ids.workout }))
        .expect(409);
      expect(workout.text).not.toContain(MARKER);
      const metric = await call(alice, 'post', '/body-metrics')
        .send({ id: ids.metric, measuredAt: '2026-01-11T08:00:00.000Z', weightKg: 60 })
        .expect(409);
      expect(metric.text).not.toContain(MARKER);
    });

    it('sync upserts and deletes with their ids → FORBIDDEN per change', async () => {
      const envelope = (id: string, extra: object = {}) => ({
        ...extra,
        id,
        updatedAt: new Date().toISOString(),
      });
      const routineDoc = {
        name: 'hijacked',
        exercises: [
          {
            id: randomUUID(),
            exerciseId: bench,
            sets: [{ type: 'normal', repsMin: 5, repsMax: 5 }],
          },
        ],
      };
      const res = await call(alice, 'post', '/sync/push')
        .send({
          changes: [
            { collection: 'workouts', op: 'upsert', doc: envelope(ids.workout, workoutBody()) },
            { collection: 'workouts', op: 'delete', doc: envelope(ids.workout) },
            { collection: 'routines', op: 'upsert', doc: envelope(ids.routine, routineDoc) },
            { collection: 'routines', op: 'delete', doc: envelope(ids.routine) },
            {
              collection: 'body_metrics',
              op: 'upsert',
              doc: envelope(ids.metric, { measuredAt: '2026-01-11T08:00:00.000Z', weightKg: 60 }),
            },
            { collection: 'body_metrics', op: 'delete', doc: envelope(ids.metric) },
          ],
        })
        .expect(200);
      const { results } = res.body as { results: { status: string; error?: { code: string } }[] };
      expect(results).toHaveLength(6);
      for (const result of results) {
        expect(result).toMatchObject({ status: 'error', error: { code: 'FORBIDDEN' } });
      }
      expect(res.text).not.toContain(MARKER);
    });
  });

  it("after all of the above, Bob's documents are untouched", async () => {
    for (const [collection, key] of OWNED) {
      expect(await db.collection(collection).findOne({ _id: ids[key] as never })).toEqual(
        bobSnapshot.get(key),
      );
    }
  });
});
