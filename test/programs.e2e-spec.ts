import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ExercisesSeeder, loadSeedFile } from '../src/modules/exercises/exercises.seeder';
import {
  loadTemplatesSeed,
  ProgramTemplatesSeeder,
} from '../src/modules/programs/templates/program-templates.seeder';
import { createTestApp, uniqueEmail } from './utils/create-test-app';

interface TodayBody {
  routine: {
    exercises: {
      referenceMax: unknown;
      adjustments: unknown[];
      sets: { type: string; weightKg: number; repsMax: number }[];
    }[];
  };
}

describe('Routines, programs & templates (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let free: string; // access tokens
  let premium: string;
  let otherUser: string;
  const exerciseId = new Map<string, string>(); // slug → id

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', 'es');

  const register = async (prefix: string) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail(prefix), password: 'secret-pass-1' })
        .expect(201)
    ).body as { user: { id: string; email: string }; tokens: { accessToken: string } };

  const set = (repsMin: number, repsMax: number, extra: object = {}) => ({
    type: 'normal',
    repsMin,
    repsMax,
    ...extra,
  });
  const routineBody = (name: string, exercises: object[]) => ({ name, exercises });
  const slot = (slug: string, sets: object[], extra: object = {}) => ({
    exerciseId: exerciseId.get(slug),
    sets,
    ...extra,
  });

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<Connection>(getConnectionToken());

    await app.get(ExercisesSeeder).run(loadSeedFile(), { update: false });
    await app.get(ProgramTemplatesSeeder).run(loadTemplatesSeed(), { update: false });
    for (const doc of await db.collection('exercises').find({ isGlobal: true }).toArray()) {
      exerciseId.set(doc.slug as string, doc._id as unknown as string);
    }

    free = (await register('free')).tokens.accessToken;
    otherUser = (await register('other')).tokens.accessToken;
    const pia = await register('premium');
    const premiumPlan = await db.collection('plans').findOne({ code: 'premium' });
    await db
      .collection('users')
      .updateOne(
        { _id: pia.user.id as never },
        { $set: { 'subscription.planId': premiumPlan!._id } },
      );
    premium = pia.tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('routines', () => {
    let routineId: string;

    it('creates a routine with embedded targets and supersets; responses are localized', async () => {
      const res = await as(free, http().post('/api/v1/routines'))
        .send(
          routineBody('Torso', [
            slot('barbell-bench-press', [set(5, 5, { weightKg: 80 }), set(5, 5, { weightKg: 80 })]),
            slot('triceps-pushdown', [set(10, 15)], { groupId: 'g1' }),
            slot('barbell-curl', [set(10, 15)], { groupId: 'g1' }),
          ]),
        )
        .expect(201);
      routineId = res.body.id;
      expect(res.body.exercises).toHaveLength(3);
      expect(res.body.exercises[0]).toMatchObject({
        exercise: { name: 'Press de banca con barra', mechanic: 'compound' },
        sets: [
          {
            type: 'normal',
            repsMin: 5,
            repsMax: 5,
            weightKg: 80,
            percent1RM: null,
            restSeconds: 120,
          },
          expect.any(Object),
        ],
      });
      expect(res.body.exercises[1].id).toEqual(expect.any(String));
    });

    // Bodies are factories: it.each tables are built at definition time, before beforeAll
    // has loaded the exercise ids.
    it.each([
      [
        'repsMax < repsMin',
        () => [slot('barbell-bench-press', [set(8, 5)])],
        'exercises.0.sets.0.repsMax',
      ],
      [
        'weight and %1RM together',
        () => [slot('barbell-bench-press', [set(5, 5, { weightKg: 80, percent1RM: 70 })])],
        'exercises.0.sets.0.percent1RM',
      ],
      [
        'non-contiguous superset',
        () => [
          slot('barbell-bench-press', [set(5, 5)], { groupId: 'g' }),
          slot('barbell-row', [set(5, 5)]),
          slot('pull-up', [set(5, 5)], { groupId: 'g' }),
        ],
        'exercises.0.groupId',
      ],
    ])('rejects %s', async (_label, exercises, field) => {
      const res = await as(free, http().post('/api/v1/routines'))
        .send(routineBody('Bad', exercises()))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual([expect.objectContaining({ field })]);
    });

    it('rejects exercises that do not exist or belong to another user', async () => {
      const custom = await as(otherUser, http().post('/api/v1/exercises'))
        .send({
          name: 'Secreto',
          primaryMuscle: 'chest',
          equipment: 'cable',
          mechanic: 'isolation',
        })
        .expect(201);
      const res = await as(free, http().post('/api/v1/routines'))
        .send(routineBody('X', [{ exerciseId: custom.body.id, sets: [set(5, 5)] }]))
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'EXERCISE_NOT_FOUND',
        details: { missing: [custom.body.id] },
      });
    });

    it('progression rules are Premium', async () => {
      const body = routineBody('Prog', [
        slot('barbell-bench-press', [set(8, 12)], { progression: { type: 'double_progression' } }),
      ]);
      const res = await as(free, http().post('/api/v1/routines')).send(body).expect(403);
      expect(res.body).toMatchObject({
        code: 'PLAN_FEATURE_REQUIRED',
        details: { feature: 'autoProgression' },
      });
      await as(premium, http().post('/api/v1/routines')).send(body).expect(201);
    });

    it('rejects unknown progression types and malformed rules', async () => {
      for (const progression of [{ type: 'magic' }, { type: 'percent_1rm', weeks: [] }]) {
        await as(premium, http().post('/api/v1/routines'))
          .send(routineBody('P', [slot('barbell-bench-press', [set(5, 5)], { progression })]))
          .expect(400);
      }
    });

    it('reorders slots, refusing incomplete permutations and broken supersets', async () => {
      const detail = await as(free, http().get(`/api/v1/routines/${routineId}`)).expect(200);
      const [bench, pushdown, curl] = detail.body.exercises.map((e: { id: string }) => e.id);

      const ok = await as(free, http().put(`/api/v1/routines/${routineId}/exercises/order`))
        .send({ itemIds: [pushdown, curl, bench] })
        .expect(200);
      expect(ok.body.exercises.map((e: { id: string }) => e.id)).toEqual([pushdown, curl, bench]);

      await as(free, http().put(`/api/v1/routines/${routineId}/exercises/order`))
        .send({ itemIds: [pushdown, bench] })
        .expect(400);
      const split = await as(free, http().put(`/api/v1/routines/${routineId}/exercises/order`))
        .send({ itemIds: [pushdown, bench, curl] })
        .expect(400);
      expect(split.body.details[0].constraints).toEqual(['contiguousSuperset']);
    });

    it('Free limit: 3 live routines; archiving frees a slot, unarchiving needs one', async () => {
      // free has 1. Duplicate → 2, create → 3.
      const copy = await as(free, http().post(`/api/v1/routines/${routineId}/duplicate`)).expect(
        201,
      );
      expect(copy.body.name).toBe('Torso (copia)');
      await as(free, http().post('/api/v1/routines'))
        .send(routineBody('Tres', [slot('pull-up', [set(5, 8)])]))
        .expect(201);

      const blocked = await as(free, http().post('/api/v1/routines'))
        .send(routineBody('Cuatro', [slot('pull-up', [set(5, 8)])]))
        .expect(403);
      expect(blocked.body).toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
        details: { resource: 'routines', limit: 3 },
      });

      await as(free, http().post(`/api/v1/routines/${copy.body.id}/archive`)).expect(204);
      const listed = await as(free, http().get('/api/v1/routines')).expect(200);
      expect(listed.body.meta.total).toBe(2);
      const archived = await as(free, http().get('/api/v1/routines?archived=true')).expect(200);
      expect(archived.body.items.map((r: { id: string }) => r.id)).toEqual([copy.body.id]);

      const fourth = await as(free, http().post('/api/v1/routines'))
        .send(routineBody('Cuatro', [slot('pull-up', [set(5, 8)])]))
        .expect(201);
      await as(free, http().post(`/api/v1/routines/${copy.body.id}/unarchive`)).expect(403);

      await as(free, http().delete(`/api/v1/routines/${fourth.body.id}`)).expect(204);
      await as(free, http().post(`/api/v1/routines/${copy.body.id}/unarchive`)).expect(204);
    });

    it('other users cannot see or touch a routine', async () => {
      await as(otherUser, http().get(`/api/v1/routines/${routineId}`)).expect(404);
      await as(otherUser, http().delete(`/api/v1/routines/${routineId}`)).expect(404);
    });
  });

  describe('programs', () => {
    let upper: string;
    let lower: string;
    let programId: string;

    beforeAll(async () => {
      const make = async (name: string, slug: string, weightKg: number) =>
        (
          await as(premium, http().post('/api/v1/routines'))
            .send(
              routineBody(name, [slot(slug, [set(5, 5, { weightKg }), set(5, 5, { weightKg })])]),
            )
            .expect(201)
        ).body.id as string;
      upper = await make('Upper', 'barbell-bench-press', 100);
      lower = await make('Lower', 'barbell-back-squat', 140);
    });

    const programBody = (weeks: number) => ({
      name: 'Bloque',
      durationWeeks: weeks,
      weeks: Array.from({ length: weeks }, () => ({
        days: [
          { weekday: 1, routineId: upper, label: 'Lunes' },
          { weekday: 4, routineId: lower },
        ],
      })),
      deload: { weeks: [weeks], mode: 'weight', percent: 40 },
    });

    it('creates a draft, validating structure and ownership', async () => {
      const bad = await as(premium, http().post('/api/v1/programs'))
        .send({ ...programBody(2), durationWeeks: 3 })
        .expect(400);
      expect(bad.body.details).toEqual([expect.objectContaining({ field: 'weeks' })]);

      const dupDay = programBody(1);
      dupDay.weeks[0]!.days.push({ weekday: 1, routineId: lower });
      await as(premium, http().post('/api/v1/programs')).send(dupDay).expect(400);

      const foreign = await as(otherUser, http().post('/api/v1/programs'))
        .send(programBody(1))
        .expect(400);
      expect(foreign.body.code).toBe('ROUTINE_NOT_FOUND');

      const res = await as(premium, http().post('/api/v1/programs'))
        .send(programBody(2))
        .expect(201);
      programId = res.body.id;
      expect(res.body).toMatchObject({ status: 'draft', startDate: null });
      expect(res.body.weeks[0].days[0]).toMatchObject({ routineName: 'Upper', label: 'Lunes' });
    });

    it('a routine used by a program cannot be deleted', async () => {
      const res = await as(premium, http().delete(`/api/v1/routines/${upper}`)).expect(409);
      expect(res.body.code).toBe('ROUTINE_IN_USE');
    });

    it('activates with a local start date; today follows the calendar', async () => {
      // 2024-01-01 is a Monday.
      await as(premium, http().post(`/api/v1/programs/${programId}/activate`))
        .send({ startDate: '2024-01-01' })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({ status: 'active', startDate: '2024-01-01' }),
        );

      const today = (date: string) =>
        as(premium, http().get(`/api/v1/programs/active/today?date=${date}`));

      const before = await today('2023-12-31').expect(200);
      expect(before.body).toMatchObject({ status: 'not_started', startsInDays: 1, routine: null });

      const monday = await today('2024-01-01').expect(200);
      expect(monday.body).toMatchObject({
        status: 'training',
        week: 1,
        isDeloadWeek: false,
        dayLabel: 'Lunes',
      });
      expect(monday.body.routine.exercises[0]).toMatchObject({
        name: 'Press de banca con barra',
        sets: [{ weightKg: 100 }, { weightKg: 100 }],
      });

      const tuesday = await today('2024-01-02').expect(200);
      expect(tuesday.body).toMatchObject({ status: 'rest', week: 1, routine: null });

      // Week 2 is the deload week (−40 % weight, Premium).
      const deload = await today('2024-01-11').expect(200);
      expect(deload.body).toMatchObject({
        status: 'training',
        week: 2,
        isDeloadWeek: true,
        progressionEnabled: true,
      });
      expect(
        deload.body.routine.exercises[0].sets.map((s: { weightKg: number }) => s.weightKg),
      ).toEqual([85, 85]);
      expect(deload.body.routine.exercises[0].adjustments).toEqual([
        { code: 'DELOAD_WEIGHT', params: { percent: 40 } },
      ]);

      const after = await today('2024-01-15').expect(200);
      expect(after.body.status).toBe('finished');

      await as(premium, http().get('/api/v1/programs/active/today?date=2024-13-01')).expect(400);
    });

    it('Free: only one active program', async () => {
      const r = await as(otherUser, http().post('/api/v1/routines'))
        .send(routineBody('R', [slot('pull-up', [set(5, 8)])]))
        .expect(201);
      const body = {
        name: 'P',
        durationWeeks: 1,
        weeks: [{ days: [{ weekday: 1, routineId: r.body.id }] }],
      };
      const p1 = await as(otherUser, http().post('/api/v1/programs')).send(body).expect(201);
      const p2 = await as(otherUser, http().post('/api/v1/programs')).send(body).expect(201);

      await as(otherUser, http().post(`/api/v1/programs/${p1.body.id}/activate`))
        .send({})
        .expect(200);
      await as(otherUser, http().post(`/api/v1/programs/${p1.body.id}/activate`))
        .send({})
        .expect(200); // idempotent
      const blocked = await as(otherUser, http().post(`/api/v1/programs/${p2.body.id}/activate`))
        .send({})
        .expect(403);
      expect(blocked.body).toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
        details: { resource: 'activePrograms' },
      });

      await as(otherUser, http().post(`/api/v1/programs/${p1.body.id}/complete`)).expect(200);
      await as(otherUser, http().post(`/api/v1/programs/${p1.body.id}/activate`))
        .send({})
        .expect(409);
      await as(otherUser, http().patch(`/api/v1/programs/${p1.body.id}`))
        .send({ durationWeeks: 2 })
        .expect(409);
      await as(otherUser, http().patch(`/api/v1/programs/${p1.body.id}`))
        .send({ name: 'Hecho' })
        .expect(200);
      await as(otherUser, http().post(`/api/v1/programs/${p2.body.id}/activate`))
        .send({})
        .expect(200);
    });

    it('no active program → 404 NO_ACTIVE_PROGRAM', async () => {
      const someone = await register('idle');
      const res = await as(
        someone.tokens.accessToken,
        http().get('/api/v1/programs/active/today'),
      ).expect(404);
      expect(res.body.code).toBe('NO_ACTIVE_PROGRAM');
    });
  });

  describe('program templates', () => {
    const templateId = async (slug: string) => {
      const list = await as(free, http().get('/api/v1/program-templates')).expect(200);
      return (list.body as { id: string; slug: string }[]).find((t) => t.slug === slug)!.id;
    };

    it('lists the seeded templates, localized', async () => {
      const res = await as(free, http().get('/api/v1/program-templates')).expect(200);
      expect(res.body.map((t: { slug: string }) => t.slug)).toEqual([
        'ppl-6-days',
        'upper-lower-4-days',
        'full-body-3-days',
        'strength-block-4-weeks',
      ]);
      expect(res.body[0]).toMatchObject({
        name: 'Empuje / Tirón / Pierna (6 días)',
        daysPerWeek: 6,
        routineCount: 3,
        usesAutoProgression: true,
      });
    });

    it('detail resolves exercise slugs to localized names', async () => {
      const res = await as(
        free,
        http().get(`/api/v1/program-templates/${await templateId('full-body-3-days')}`),
      ).expect(200);
      expect(res.body.routines[0].exercises[0]).toMatchObject({
        exerciseSlug: 'barbell-back-squat',
        name: 'Sentadilla trasera con barra',
        exerciseId: exerciseId.get('barbell-back-squat'),
      });
      // A/B alternation: week 1 A-B-A, week 2 B-A-B
      expect(res.body.weeks[0].days.map((d: { routineKey: string }) => d.routineKey)).toEqual([
        'full-body-a',
        'full-body-b',
        'full-body-a',
      ]);
      expect(res.body.weeks[1].days.map((d: { routineKey: string }) => d.routineKey)).toEqual([
        'full-body-b',
        'full-body-a',
        'full-body-b',
      ]);
    });

    it('Free copy: needs room for every routine, drops progression rules', async () => {
      const fresh = await register('copier');
      const token = fresh.tokens.accessToken;
      const ppl = await templateId('ppl-6-days');

      const res = await as(token, http().post(`/api/v1/program-templates/${ppl}/copy`))
        .send({})
        .expect(201);
      expect(res.body).toMatchObject({ progressionRulesDropped: true, skippedExercises: [] });
      expect(res.body.routineIds).toHaveLength(3);
      expect(res.body.program).toMatchObject({
        status: 'draft',
        durationWeeks: 6,
        name: 'Empuje / Tirón / Pierna (6 días)',
      });

      const push = await as(token, http().get(`/api/v1/routines/${res.body.routineIds[0]}`)).expect(
        200,
      );
      expect(push.body.name).toBe('Empuje');
      expect(
        push.body.exercises.every((e: { progression: unknown }) => e.progression === null),
      ).toBe(true);

      const again = await as(token, http().post(`/api/v1/program-templates/${ppl}/copy`))
        .send({})
        .expect(403);
      expect(again.body.details).toMatchObject({
        resource: 'routines',
        limit: 3,
        current: 3,
        requested: 3,
      });
    });

    it('Premium copy of the strength block computes week-1 percentages from training maxes', async () => {
      const block = await templateId('strength-block-4-weeks');
      const res = await as(premium, http().post(`/api/v1/program-templates/${block}/copy`))
        .send({
          name: 'Mi bloque',
          trainingMaxes: [
            { exerciseId: exerciseId.get('barbell-back-squat'), kg: 200 },
            { exerciseId: exerciseId.get('barbell-bench-press'), kg: 140 },
            { exerciseId: exerciseId.get('conventional-deadlift'), kg: 230 },
          ],
        })
        .expect(201);
      expect(res.body.progressionRulesDropped).toBe(false);

      // Swap the active program for the block: deactivate the previous one first.
      const active = await as(premium, http().get('/api/v1/programs?status=active')).expect(200);
      for (const p of active.body as { id: string }[]) {
        await as(premium, http().post(`/api/v1/programs/${p.id}/deactivate`)).expect(200);
      }
      await as(premium, http().post(`/api/v1/programs/${res.body.program.id}/activate`))
        .send({ startDate: '2024-01-01' })
        .expect(200);

      const today = async (date: string): Promise<TodayBody> =>
        (await as(premium, http().get(`/api/v1/programs/active/today?date=${date}`)).expect(200))
          .body as TodayBody;

      // Week 1, Monday: squat 5×5 @ 70 % of 200 = 140, warmup @ 50 % = 100.
      const w1 = await today('2024-01-01');
      const squat = w1.routine.exercises[0]!;
      expect(squat.referenceMax).toEqual({ kg: 200, source: 'training_max' });
      expect(
        squat.sets.map((s: { type: string; weightKg: number; repsMax: number }) => [
          s.type,
          s.weightKg,
          s.repsMax,
        ]),
      ).toEqual([
        ['warmup', 100, 5],
        ['normal', 140, 5],
        ['normal', 140, 5],
        ['normal', 140, 5],
        ['normal', 140, 5],
        ['normal', 140, 5],
      ]);

      // Week 4, Friday: deadlift 2×2 @ 85 % of 230 = 195.5 → 195 (2.5 kg plates).
      const w4 = await today('2024-01-26');
      const deadlift = w4.routine.exercises[0]!;
      expect(deadlift.sets.filter((s: { type: string }) => s.type === 'normal')).toEqual([
        { type: 'normal', repsMin: 2, repsMax: 2, weightKg: 195, restSeconds: 240 },
        { type: 'normal', repsMin: 2, repsMax: 2, weightKg: 195, restSeconds: 240 },
      ]);
      // Accessories without history: double progression starts from the prescription.
      expect(w4.routine.exercises[1]!.adjustments).toEqual([{ code: 'NO_HISTORY' }]);
    });
  });
});
