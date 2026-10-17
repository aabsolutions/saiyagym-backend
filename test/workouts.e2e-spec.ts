import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ExercisesSeeder, loadSeedFile } from '../src/modules/exercises/exercises.seeder';
import type { WorkoutChangedEvent } from '../src/modules/workouts/workout.events';
import { createTestApp, uniqueEmail } from './utils/create-test-app';

describe('Workouts (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let ana: string;
  let anaId: string;
  let other: string;
  const ex = new Map<string, string>(); // slug → id
  const events: { name: string; payload: WorkoutChangedEvent }[] = [];

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', 'es');

  const register = async (prefix: string) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(prefix), password: 'secret-pass-1' })
        .expect(201)
    ).body as { user: { id: string }; tokens: { accessToken: string } };

  const set = (type: string, weightKg: number | null, reps: number | null, completed = true) => ({
    id: randomUUID(),
    type,
    weightKg,
    reps,
    completed,
  });

  const workout = (
    startedAt: string,
    finished: boolean,
    exercises: { slug: string; sets: object[] }[],
    id = randomUUID(),
  ) => ({
    id,
    name: 'Torso',
    startedAt,
    finishedAt: finished ? new Date(new Date(startedAt).getTime() + 3_600_000).toISOString() : null,
    exercises: exercises.map((e) => ({
      id: randomUUID(),
      exerciseId: ex.get(e.slug),
      sets: e.sets,
    })),
  });

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<Connection>(getConnectionToken());
    await app.get(ExercisesSeeder).run(loadSeedFile(), { update: false });
    for (const doc of await db.collection('exercises').find({ isGlobal: true }).toArray()) {
      ex.set(doc.slug as string, doc._id as unknown as string);
    }
    app.get(EventEmitter2).onAny((name: string | string[], payload: WorkoutChangedEvent) => {
      events.push({ name: String(name), payload });
    });

    const a = await register('ana');
    ana = a.tokens.accessToken;
    anaId = a.user.id;
    other = (await register('other')).tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const eventNames = () => events.map((e) => e.name);

  describe('create (idempotent on the client id)', () => {
    // Built in beforeAll, not at describe time: exercise ids are only loaded in the outer beforeAll.
    let body: ReturnType<typeof workout>;
    beforeAll(() => {
      body = workout('2024-03-04T10:00:00.000Z', true, [
        {
          slug: 'barbell-bench-press',
          sets: [
            set('warmup', 60, 10),
            set('normal', 100, 5),
            set('normal', 100, 5),
            set('normal', 100, 4, false),
          ],
        },
        { slug: 'triceps-pushdown', sets: [set('normal', 30, 12), set('dropset', 20, 10)] },
      ]);
    });

    it('creates with server-computed volume and duration, and emits workout.finished', async () => {
      events.length = 0;
      const res = await as(ana, http().post('/api/v1/workouts')).send(body).expect(201);
      expect(res.body).toMatchObject({
        id: body.id,
        durationSeconds: 3600,
        volumeKg: 100 * 5 * 2 + 30 * 12 + 20 * 10, // warmup and uncompleted set excluded
        workingSets: 4,
      });
      expect(res.body.exercises[0]).toMatchObject({
        name: 'Press de banca con barra',
        volumeKg: 1000,
      });
      expect(eventNames()).toEqual(['workout.finished']);
      expect(events[0]!.payload).toMatchObject({
        userId: anaId,
        workoutId: body.id,
        source: 'rest',
      });
    });

    it('a retried create returns the stored workout (200) without duplicating or re-emitting', async () => {
      events.length = 0;
      const res = await as(ana, http().post('/api/v1/workouts'))
        .send({ ...body, name: 'changed' })
        .expect(200);
      expect(res.body.name).toBe('Torso');
      expect(await db.collection('workouts').countDocuments({ _id: body.id as never })).toBe(1);
      expect(events).toEqual([]);
    });

    it('another user cannot take that id', async () => {
      await as(other, http().post('/api/v1/workouts')).send(body).expect(409);
      await as(other, http().get(`/api/v1/workouts/${body.id}`)).expect(404);
    });

    it.each([
      ['finish before start', { finishedAt: '2024-03-04T09:00:00.000Z' }, 'finishedAt'],
      [
        'a session in the future',
        { startedAt: '2999-01-01T00:00:00.000Z', finishedAt: null },
        'startedAt',
      ],
    ])('rejects %s', async (_label, override, field) => {
      const res = await as(ana, http().post('/api/v1/workouts'))
        .send({ ...workout('2024-03-04T10:00:00.000Z', true, []), ...override })
        .expect(400);
      expect(res.body.details).toEqual([expect.objectContaining({ field })]);
    });

    it('rejects exercises the user cannot access', async () => {
      const res = await as(ana, http().post('/api/v1/workouts'))
        .send({
          ...workout('2024-03-04T10:00:00.000Z', true, []),
          exercises: [{ id: randomUUID(), exerciseId: randomUUID(), sets: [] }],
        })
        .expect(400);
      expect(res.body.code).toBe('EXERCISE_NOT_FOUND');
    });
  });

  describe('lifecycle events', () => {
    it('in progress → finished → edited → deleted', async () => {
      events.length = 0;
      const live = workout('2024-03-06T10:00:00.000Z', false, [
        { slug: 'pull-up', sets: [set('normal', null, 8)] },
      ]);
      await as(ana, http().post('/api/v1/workouts')).send(live).expect(201);
      await as(ana, http().patch(`/api/v1/workouts/${live.id}`))
        .send({ notes: 'still going' })
        .expect(200);
      expect(events).toEqual([]); // in-progress changes don't touch stats

      await as(ana, http().patch(`/api/v1/workouts/${live.id}`))
        .send({ finishedAt: '2024-03-06T11:00:00.000Z', rating: 4 })
        .expect(200);
      await as(ana, http().patch(`/api/v1/workouts/${live.id}`))
        .send({ rating: 5 })
        .expect(200);
      await as(ana, http().delete(`/api/v1/workouts/${live.id}`)).expect(204);
      expect(eventNames()).toEqual(['workout.finished', 'workout.updated', 'workout.deleted']);

      await as(ana, http().get(`/api/v1/workouts/${live.id}`)).expect(404);
    });

    it('PATCH cannot null required fields', async () => {
      const w = workout('2024-03-07T10:00:00.000Z', true, []);
      await as(ana, http().post('/api/v1/workouts')).send(w).expect(201);
      await as(ana, http().patch(`/api/v1/workouts/${w.id}`))
        .send({ startedAt: null })
        .expect(400);
    });
  });

  describe('listing', () => {
    it('paginates newest first and filters by date range and status', async () => {
      await as(ana, http().post('/api/v1/workouts'))
        .send(workout('2024-03-10T10:00:00.000Z', false, []))
        .expect(201);

      const all = await as(ana, http().get('/api/v1/workouts?limit=2')).expect(200);
      expect(all.body.meta).toEqual({ page: 1, limit: 2, total: 3 });
      expect(all.body.items.map((w: { startedAt: string }) => w.startedAt)).toEqual([
        '2024-03-10T10:00:00.000Z',
        '2024-03-07T10:00:00.000Z',
      ]);

      const march = await as(
        ana,
        http().get('/api/v1/workouts?from=2024-03-05&to=2024-03-08'),
      ).expect(200);
      expect(march.body.meta.total).toBe(1);

      const finished = await as(ana, http().get('/api/v1/workouts?status=finished')).expect(200);
      expect(finished.body.meta.total).toBe(2);
      const inProgress = await as(ana, http().get('/api/v1/workouts?status=in_progress')).expect(
        200,
      );
      expect(inProgress.body.meta.total).toBe(1);
    });
  });

  describe('per-exercise history', () => {
    it('last-performance: most recent FINISHED session, all slots merged', async () => {
      const bench = ex.get('barbell-bench-press')!;
      await as(ana, http().post('/api/v1/workouts'))
        .send(
          workout('2024-03-12T10:00:00.000Z', true, [
            { slug: 'barbell-bench-press', sets: [set('normal', 102.5, 5)] },
            { slug: 'barbell-bench-press', sets: [set('normal', 90, 8)] },
          ]),
        )
        .expect(201);
      // An in-progress session afterwards must not count as "last time".
      await as(ana, http().post('/api/v1/workouts'))
        .send(
          workout('2024-03-14T10:00:00.000Z', false, [
            { slug: 'barbell-bench-press', sets: [set('normal', 200, 1, false)] },
          ]),
        )
        .expect(201);

      const res = await as(ana, http().get(`/api/v1/exercises/${bench}/last-performance`)).expect(
        200,
      );
      expect(res.body.lastPerformance).toMatchObject({
        startedAt: '2024-03-12T10:00:00.000Z',
        volumeKg: 102.5 * 5 + 90 * 8,
        bestE1RM: 119.6, // 102.5 × (1 + 5/30)
      });
      expect(res.body.lastPerformance.sets.map((s: { weightKg: number }) => s.weightKg)).toEqual([
        102.5, 90,
      ]);

      const none = await as(
        other,
        http().get(`/api/v1/exercises/${bench}/last-performance`),
      ).expect(200);
      expect(none.body).toEqual({ lastPerformance: null });
    });

    it('history: paginated, newest first', async () => {
      const bench = ex.get('barbell-bench-press')!;
      const page1 = await as(ana, http().get(`/api/v1/exercises/${bench}/history?limit=1`)).expect(
        200,
      );
      expect(page1.body.meta).toEqual({ page: 1, limit: 1, total: 2 });
      expect(page1.body.items[0].startedAt).toBe('2024-03-12T10:00:00.000Z');
      const page2 = await as(
        ana,
        http().get(`/api/v1/exercises/${bench}/history?limit=1&page=2`),
      ).expect(200);
      expect(page2.body.items[0]).toMatchObject({
        startedAt: '2024-03-04T10:00:00.000Z',
        bestE1RM: 116.7,
      });
    });
  });

  describe('feeds progression (WorkoutHistoryProvider)', () => {
    it('after hitting the top of the range on every set, today() increases the weight', async () => {
      const pia = await register('premium');
      const premiumPlan = await db.collection('plans').findOne({ code: 'premium' });
      await db
        .collection('users')
        .updateOne(
          { _id: pia.user.id as never },
          { $set: { 'subscription.planId': premiumPlan!._id } },
        );
      const token = pia.tokens.accessToken;

      const routine = await as(token, http().post('/api/v1/routines'))
        .send({
          name: 'Press',
          exercises: [
            {
              exerciseId: ex.get('barbell-bench-press'),
              sets: [1, 2, 3].map(() => ({
                type: 'normal',
                repsMin: 8,
                repsMax: 12,
                weightKg: 80,
              })),
              progression: { type: 'double_progression' },
            },
          ],
        })
        .expect(201);
      const program = await as(token, http().post('/api/v1/programs'))
        .send({
          name: 'P',
          durationWeeks: 2,
          weeks: [0, 1].map(() => ({ days: [{ weekday: 1, routineId: routine.body.id }] })),
        })
        .expect(201);
      await as(token, http().post(`/api/v1/programs/${program.body.id}/activate`))
        .send({ startDate: '2024-01-01' })
        .expect(200);

      const before = await as(
        token,
        http().get('/api/v1/programs/active/today?date=2024-01-01'),
      ).expect(200);
      expect(before.body.routine.exercises[0].adjustments).toEqual([{ code: 'NO_HISTORY' }]);

      await as(token, http().post('/api/v1/workouts'))
        .send(
          workout('2024-01-01T10:00:00.000Z', true, [
            {
              slug: 'barbell-bench-press',
              sets: [set('normal', 80, 12), set('normal', 80, 12), set('normal', 80, 12)],
            },
          ]),
        )
        .expect(201);

      const after = await as(
        token,
        http().get('/api/v1/programs/active/today?date=2024-01-08'),
      ).expect(200);
      const bench = after.body.routine.exercises[0];
      expect(bench.adjustments).toEqual([{ code: 'INCREASE', params: { incrementKg: 2.5 } }]);
      expect(bench.sets.map((s: { weightKg: number }) => s.weightKg)).toEqual([82.5, 82.5, 82.5]);
    });
  });
});
