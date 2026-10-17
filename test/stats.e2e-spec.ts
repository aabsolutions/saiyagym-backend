import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { UTF8_BOM } from '../src/common/utils/csv.util';
import type { Env } from '../src/config/env.schema';
import { ExercisesSeeder, loadSeedFile } from '../src/modules/exercises/exercises.seeder';
import { MediaService } from '../src/modules/media/media.service';
import { createTestApp, createTestUser, uniqueEmail } from './utils/create-test-app';

const DAY = 86_400_000;
const daysAgo = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** Real MediaService with fake Cloudinary credentials; the network call (destroy) is stubbed. */
const fakeConfig = {
  get: (key: keyof Env) =>
    ({
      CLOUDINARY_CLOUD_NAME: 'demo-cloud',
      CLOUDINARY_API_KEY: '123',
      CLOUDINARY_API_SECRET: 'secret',
      CLOUDINARY_FOLDER: 'gymapp',
      NODE_ENV: 'test',
      MEDIA_MAX_IMAGE_BYTES: 5_000_000,
    })[key as string],
} as unknown as ConfigService<Env, true>;
const media = new MediaService(fakeConfig);
const destroySpy = jest.spyOn(media, 'destroyPrivateImage').mockResolvedValue(undefined);

describe('Records, stats, measurements, photos & export (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  const ex = new Map<string, string>();

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', 'en');

  /** Users are created directly (many per file would hit the real 5/hour register limit). */
  const register = async (prefix: string, premium = false) =>
    (await createTestUser(app, { premium, email: uniqueEmail(prefix) })).token;

  const set = (weightKg: number, reps: number, type = 'normal') => ({
    id: randomUUID(),
    type,
    weightKg,
    reps,
    completed: true,
  });
  const workout = (
    startedAt: string,
    entries: [string, ReturnType<typeof set>[]][],
    extra: object = {},
  ) => ({
    id: randomUUID(),
    name: 'Session',
    startedAt,
    finishedAt: new Date(new Date(startedAt).getTime() + 3_600_000).toISOString(),
    exercises: entries.map(([slug, sets]) => ({
      id: randomUUID(),
      exerciseId: ex.get(slug),
      sets,
    })),
    ...extra,
  });
  const log = async (token: string, body: object) =>
    (await as(token, http().post('/api/v1/workouts')).send(body).expect(201)).body as {
      id: string;
      newRecords: { type: string; value: number; previous: number; exerciseId: string }[];
    };

  beforeAll(async () => {
    ({ app } = await createTestApp((builder) =>
      builder.overrideProvider(MediaService).useValue(media),
    ));
    db = app.get<Connection>(getConnectionToken());
    await app.get(ExercisesSeeder).run(loadSeedFile(), { update: false });
    for (const doc of await db.collection('exercises').find({ isGlobal: true }).toArray()) {
      ex.set(doc.slug as string, doc._id as unknown as string);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('personal records', () => {
    let ana: string;
    let bench: string;
    let w1: string;
    let w2: string;
    const records = async (): Promise<Record<string, unknown>> =>
      (await as(ana, http().get(`/api/v1/exercises/${bench}/records`)).expect(200)).body as Record<
        string,
        unknown
      >;

    beforeAll(async () => {
      ana = await register('ana');
      bench = ex.get('barbell-bench-press')!;
    });

    it('the first session is the baseline: records stored, none reported as new', async () => {
      const res = await log(
        ana,
        workout(daysAgo(10), [
          ['barbell-bench-press', [set(60, 10, 'warmup'), set(100, 5), set(100, 5)]],
        ]),
      );
      w1 = res.id;
      expect(res.newRecords).toEqual([]);
      expect(await records()).toMatchObject({
        maxWeight: { value: 100, workoutId: w1 },
        bestE1RM: { value: 116.7 }, // Epley 100×(1+5/30); the 60×10 warmup never counts
        maxVolume: { value: 1000 },
      });
    });

    it('a better session reports every record it broke in the same response', async () => {
      const res = await log(
        ana,
        workout(daysAgo(5), [['barbell-bench-press', [set(105, 5), set(100, 7)]]]),
      );
      w2 = res.id;
      expect(res.newRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            exerciseId: bench,
            type: 'maxWeight',
            value: 105,
            previous: 100,
          }),
          expect.objectContaining({ type: 'bestE1RM', value: 123.3, previous: 116.7 }),
          expect.objectContaining({ type: 'maxVolume', value: 1225, previous: 1000 }),
          expect.objectContaining({ type: 'repsAtWeight', value: 7, previous: 5 }),
        ]),
      );
      expect(res.newRecords).toHaveLength(4);
    });

    it('editing the record session down recalculates (records fall back to the runner-up)', async () => {
      const res = await as(ana, http().patch(`/api/v1/workouts/${w2}`))
        .send({ exercises: [{ id: randomUUID(), exerciseId: bench, sets: [set(95, 5)] }] })
        .expect(200);
      expect(res.body.newRecords).toEqual([]);
      expect(await records()).toMatchObject({
        maxWeight: { value: 100, workoutId: w1 },
        bestE1RM: { value: 116.7, workoutId: w1 },
      });
    });

    it('deleting the holder recalculates from what remains', async () => {
      await as(ana, http().delete(`/api/v1/workouts/${w1}`)).expect(204);
      expect(await records()).toMatchObject({
        maxWeight: { value: 95, workoutId: w2 },
        maxVolume: { value: 475 },
      });
    });

    it('workouts arriving through sync update records too', async () => {
      const doc = {
        ...workout(daysAgo(1), [['barbell-bench-press', [set(110, 3)]]]),
        updatedAt: new Date().toISOString(),
      };
      await as(ana, http().post('/api/v1/sync/push'))
        .send({ changes: [{ collection: 'workouts', op: 'upsert', doc }] })
        .expect(200);
      expect(await records()).toMatchObject({ maxWeight: { value: 110, workoutId: doc.id } });
    });

    it('GET /records lists records per exercise with names', async () => {
      const res = await as(ana, http().get('/api/v1/records')).expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({ exerciseId: bench, name: 'Barbell bench press' }),
      ]);
    });
  });

  describe('Free plan: 90-day stats window (server-side)', () => {
    let free: string;
    let premium: string;
    const squat = () => ex.get('barbell-back-squat')!;

    beforeAll(async () => {
      free = await register('free');
      premium = await register('premium', true);
      for (const token of [free, premium]) {
        await log(token, workout(daysAgo(120), [['barbell-back-squat', [set(100, 5)]]]));
        await log(token, workout(daysAgo(10), [['barbell-back-squat', [set(110, 5)]]]));
      }
    });

    it('Free never sees data older than 90 days, even when asking for it', async () => {
      for (const query of ['', `?from=${daysAgo(365)}`]) {
        const res = await as(free, http().get(`/api/v1/stats/exercise/${squat()}${query}`)).expect(
          200,
        );
        expect(res.body.points).toHaveLength(1);
        expect(res.body.points[0].maxWeightKg).toBe(110);
        expect(res.body.window.limitedByPlan).toBe(true);
      }
    });

    it('Premium sees the full history', async () => {
      const res = await as(premium, http().get(`/api/v1/stats/exercise/${squat()}`)).expect(200);
      expect(res.body.points.map((p: { maxWeightKg: number }) => p.maxWeightKg)).toEqual([
        100, 110,
      ]);
      expect(res.body.points[1].bestE1RM).toBe(128.3);
      expect(res.body.window).toMatchObject({ from: null, limitedByPlan: false });
    });

    it('applies to every stats endpoint (frequency, muscle volume) and to measurement series', async () => {
      const year = new Date(daysAgo(120)).getUTCFullYear();
      const freq = await as(free, http().get(`/api/v1/stats/frequency?year=${year}`)).expect(200);
      expect(
        freq.body.heatmap.some((d: { date: string }) => d.date === daysAgo(120).slice(0, 10)),
      ).toBe(false);

      const vol = await as(free, http().get('/api/v1/stats/muscle-volume')).expect(200);
      expect(vol.body.rows.reduce((n: number, r: { sets: number }) => n + r.sets, 0)).toBe(1);

      await as(free, http().post('/api/v1/body-metrics'))
        .send({ measuredAt: daysAgo(150), weightKg: 85 })
        .expect(201);
      await as(free, http().post('/api/v1/body-metrics'))
        .send({ measuredAt: daysAgo(3), weightKg: 82 })
        .expect(201);
      const series = await as(
        free,
        http().get('/api/v1/body-metrics/series?metric=weightKg'),
      ).expect(200);
      expect(series.body.points.map((p: { value: number }) => p.value)).toEqual([82]);
      // The list itself is the user's data, not a statistic: full history.
      const list = await as(free, http().get('/api/v1/body-metrics')).expect(200);
      expect(list.body.meta.total).toBe(2);
    });
  });

  describe('stats endpoints', () => {
    let pia: string;

    beforeAll(async () => {
      pia = await register('pia', true);
    });

    it('summary: this week/month totals and weekly streak', async () => {
      await log(
        pia,
        workout(new Date(Date.now() - 2 * 3_600_000).toISOString(), [
          ['barbell-bench-press', [set(80, 10), set(80, 10)]],
        ]),
      );
      await log(pia, workout(daysAgo(7), [['barbell-bench-press', [set(80, 8)]]]));
      const res = await as(pia, http().get('/api/v1/stats/summary?tz=UTC')).expect(200);
      expect(res.body.week).toMatchObject({ sessions: 1, volumeKg: 1600, workingSets: 2 });
      expect(res.body.month.sessions).toBeGreaterThanOrEqual(1);
      expect(res.body.streakWeeks).toBe(2);
    });

    it('buckets days in the user’s time zone', async () => {
      const token = await register('tz', true);
      await log(token, workout('2024-03-05T02:30:00.000Z', [['pull-up', [set(10, 8)]]])); // 23:30 on the 4th in Buenos Aires
      const utc = await as(token, http().get('/api/v1/stats/frequency?year=2024&tz=UTC')).expect(
        200,
      );
      const ba = await as(
        token,
        http().get('/api/v1/stats/frequency?year=2024&tz=America/Argentina/Buenos_Aires'),
      ).expect(200);
      expect(utc.body.heatmap.map((d: { date: string }) => d.date)).toEqual(['2024-03-05']);
      expect(ba.body.heatmap.map((d: { date: string }) => d.date)).toEqual(['2024-03-04']);
      await as(token, http().get('/api/v1/stats/summary?tz=Mars/Olympus')).expect(400);
    });

    it('muscle volume: working sets and kg per primary muscle and week', async () => {
      const token = await register('vol', true);
      await log(
        token,
        workout('2024-03-06T10:00:00.000Z', [
          ['barbell-bench-press', [set(60, 10, 'warmup'), set(100, 5), set(100, 5)]],
          ['barbell-back-squat', [set(140, 3)]],
        ]),
      );
      const res = await as(
        token,
        http().get('/api/v1/stats/muscle-volume?from=2024-03-01&to=2024-03-31'),
      ).expect(200);
      expect(res.body.rows).toEqual([
        { week: '2024-03-04', muscle: 'chest', sets: 2, volumeKg: 1000 },
        { week: '2024-03-04', muscle: 'quads', sets: 1, volumeKg: 420 },
      ]);
    });

    it('powerlifting total: running best e1RM of the three lifts', async () => {
      const token = await register('pl', true);
      await log(
        token,
        workout('2024-02-05T10:00:00.000Z', [
          ['barbell-back-squat', [set(180, 1)]],
          ['barbell-bench-press', [set(120, 1)]],
        ]),
      );
      await log(token, workout('2024-02-14T10:00:00.000Z', [['sumo-deadlift', [set(220, 1)]]]));
      await log(
        token,
        workout('2024-02-21T10:00:00.000Z', [['barbell-back-squat', [set(170, 1)]]]),
      ); // lower: running best keeps 180
      const res = await as(
        token,
        http().get('/api/v1/stats/powerlifting-total?from=2024-01-01'),
      ).expect(200);
      expect(res.body.points).toEqual([
        { weekStart: '2024-02-05', squat: 180, bench: 120, deadlift: null, total: null },
        { weekStart: '2024-02-12', squat: 180, bench: 120, deadlift: 220, total: 520 },
        { weekStart: '2024-02-19', squat: 180, bench: 120, deadlift: 220, total: 520 },
      ]);
      expect(res.body.bestTotal).toBe(520);
    });

    it('program adherence: planned vs completed days', async () => {
      const token = await register('adh', true);
      const routine = await as(token, http().post('/api/v1/routines'))
        .send({
          name: 'R',
          exercises: [
            { exerciseId: ex.get('pull-up'), sets: [{ type: 'normal', repsMin: 5, repsMax: 8 }] },
          ],
        })
        .expect(201);
      const program = await as(token, http().post('/api/v1/programs'))
        .send({
          name: 'P',
          durationWeeks: 2,
          weeks: [0, 1].map(() => ({
            days: [
              { weekday: 1, routineId: routine.body.id },
              { weekday: 3, routineId: routine.body.id },
            ],
          })),
        })
        .expect(201);
      // 2024-01-01 is a Monday; the program is over by now → 4 planned days.
      await as(token, http().post(`/api/v1/programs/${program.body.id}/activate`))
        .send({ startDate: '2024-01-01' })
        .expect(200);
      const programWorkout = (startedAt: string) =>
        workout(startedAt, [['pull-up', [set(10, 8)]]], { programId: program.body.id });
      await log(token, programWorkout('2024-01-01T10:00:00.000Z')); // Mon wk1 ✓
      await log(token, programWorkout('2024-01-08T10:00:00.000Z')); // Mon wk2 ✓
      await log(token, programWorkout('2024-01-09T10:00:00.000Z')); // Tue: unscheduled → extra

      const res = await as(
        token,
        http().get(`/api/v1/stats/program-adherence/${program.body.id}`),
      ).expect(200);
      expect(res.body).toMatchObject({
        plannedSessions: 4,
        completedSessions: 2,
        adherencePercent: 50,
        extraSessions: 1,
        weeks: [
          { week: 1, planned: 2, completed: 1 },
          { week: 2, planned: 2, completed: 1 },
        ],
      });
    });
  });

  describe('body metrics', () => {
    it('CRUD with idempotent create; at least one measurement must remain', async () => {
      const token = await register('bm');
      const id = randomUUID();
      const body = { id, measuredAt: daysAgo(1), weightKg: 80, waistCm: 82 };
      await as(token, http().post('/api/v1/body-metrics')).send(body).expect(201);
      await as(token, http().post('/api/v1/body-metrics')).send(body).expect(200);

      const patched = await as(token, http().patch(`/api/v1/body-metrics/${id}`))
        .send({ waistCm: null, bodyFatPercent: 15 })
        .expect(200);
      expect(patched.body).toMatchObject({ weightKg: 80, waistCm: null, bodyFatPercent: 15 });

      const empty = await as(token, http().patch(`/api/v1/body-metrics/${id}`))
        .send({ weightKg: null, bodyFatPercent: null })
        .expect(400);
      expect(empty.body.details).toEqual([
        { field: 'doc', constraints: ['atLeastOneMeasurement'] },
      ]);

      await as(token, http().delete(`/api/v1/body-metrics/${id}`)).expect(204);
      await as(token, http().get(`/api/v1/body-metrics/${id}`)).expect(404);
    });
  });

  describe('progress photos (Premium)', () => {
    let pia: string;

    beforeAll(async () => {
      pia = await register('photos', true);
    });

    const upload = async (token: string) => {
      const sig = await as(token, http().post('/api/v1/media/upload-signature'))
        .send({ purpose: 'progress_photo' })
        .expect(200);
      const publicId: string = sig.body.params.public_id;
      return {
        sig: sig.body,
        publicId,
        url: `https://res.cloudinary.com/demo-cloud/image/authenticated/s--x--/v1/${publicId}.jpg`,
      };
    };

    it('Free users can’t get an upload signature nor register photos', async () => {
      const free = await register('nophotos');
      const res = await as(free, http().post('/api/v1/media/upload-signature'))
        .send({ purpose: 'progress_photo' })
        .expect(403);
      expect(res.body).toMatchObject({
        code: 'PLAN_FEATURE_REQUIRED',
        details: { feature: 'progressPhotos' },
      });
      await as(free, http().post('/api/v1/progress-photos'))
        .send({
          publicId: 'x',
          format: 'jpg',
          url: 'https://x.y/z',
          view: 'front',
          takenAt: daysAgo(1),
        })
        .expect(403);
    });

    it('signature targets a private folder; registered photos are served through signed URLs', async () => {
      const { sig, publicId, url } = await upload(pia);
      expect(sig.params.type).toBe('authenticated');
      expect(publicId).toMatch(/\/users\/[0-9a-f-]{36}\/progress\/[0-9a-f-]{36}$/);

      const created = await as(pia, http().post('/api/v1/progress-photos'))
        .send({ publicId, format: 'jpg', url, view: 'front', takenAt: daysAgo(30) })
        .expect(201);
      expect(created.body.url).toMatch(
        /^https:\/\/res\.cloudinary\.com\/demo-cloud\/image\/authenticated\/s--[^/]+--\//,
      );

      const second = await upload(pia);
      await as(pia, http().post('/api/v1/progress-photos'))
        .send({
          publicId: second.publicId,
          format: 'jpg',
          url: second.url,
          view: 'front',
          takenAt: daysAgo(1),
        })
        .expect(201);
      const compare = await as(
        pia,
        http().get('/api/v1/progress-photos/compare?view=front'),
      ).expect(200);
      expect(compare.body.before.id).toBe(created.body.id);
      expect(compare.body.after.publicId).toBe(second.publicId);
    });

    it('rejects public ids outside the user’s private folder', async () => {
      const other = await register('other-photos', true);
      const { publicId, url } = await upload(other);
      const res = await as(pia, http().post('/api/v1/progress-photos'))
        .send({ publicId, format: 'jpg', url, view: 'side', takenAt: daysAgo(1) })
        .expect(400);
      expect(res.body.code).toBe('INVALID_IMAGE_URL');
    });

    it('delete removes the Cloudinary asset first; if that fails the photo stays', async () => {
      const list = await as(pia, http().get('/api/v1/progress-photos?view=front')).expect(200);
      const [photo] = list.body.items as { id: string; publicId: string }[];

      destroySpy.mockRejectedValueOnce(new Error('cloudinary down'));
      await as(pia, http().delete(`/api/v1/progress-photos/${photo!.id}`)).expect(500);
      expect(
        (await as(pia, http().get('/api/v1/progress-photos')).expect(200)).body.meta.total,
      ).toBe(2);

      destroySpy.mockClear();
      await as(pia, http().delete(`/api/v1/progress-photos/${photo!.id}`)).expect(204);
      expect(destroySpy).toHaveBeenCalledWith(photo!.publicId);
      expect(
        (await as(pia, http().get('/api/v1/progress-photos')).expect(200)).body.meta.total,
      ).toBe(1);
    });
  });

  describe('export (Premium)', () => {
    it('Free gets 403', async () => {
      const free = await register('noexport');
      const res = await as(free, http().get('/api/v1/export?format=json')).expect(403);
      expect(res.body.details).toEqual({ feature: 'dataExport' });
    });

    it('JSON (everything) and CSV (one table, injection-safe)', async () => {
      const token = await register('exporter', true);
      await log(
        token,
        workout(daysAgo(2), [['barbell-bench-press', [set(100, 5), set(100, 4)]]], {
          name: '=HYPERLINK("http://evil")',
        }),
      );
      await as(token, http().post('/api/v1/body-metrics'))
        .send({ measuredAt: daysAgo(2), weightKg: 80.5 })
        .expect(201);

      const json = await as(token, http().get('/api/v1/export?format=json')).expect(200);
      expect(json.headers['content-disposition']).toMatch(/attachment; filename="gymapp-export-/);
      expect(json.body).toMatchObject({
        format: 'gymapp-export',
        version: 1,
        units: { weight: 'kg' },
      });
      expect(json.body.workouts[0].exercises[0]).toMatchObject({
        exercise: 'Barbell bench press',
        sets: [{ weightKg: 100, reps: 5 }, { reps: 4 }],
      });
      expect(json.body.measurements[0]).toMatchObject({ weightKg: 80.5 });

      const csv = await as(token, http().get('/api/v1/export?format=csv&dataset=workouts')).expect(
        200,
      );
      expect(csv.headers['content-type']).toMatch(/^text\/csv/);
      expect(csv.text.startsWith(UTF8_BOM)).toBe(true);
      const lines = csv.text.slice(UTF8_BOM.length).trim().split('\r\n');
      expect(lines[0]).toBe(
        'started_at,workout,exercise,set,set_type,weight_kg,reps,completed,workout_duration_s,rating,exercise_notes',
      );
      expect(lines).toHaveLength(3); // header + one row per set
      expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`); // formula neutralized
      expect(lines[1]).toContain('Barbell bench press,1,normal,100,5,true');

      const measurements = await as(
        token,
        http().get('/api/v1/export?format=csv&dataset=measurements'),
      ).expect(200);
      expect(measurements.text).toContain('measured_at,weight_kg,body_fat_percent');
    });
  });
});
