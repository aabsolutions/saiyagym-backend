import { randomUUID } from 'node:crypto';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ErrorCode } from '../src/common/constants/error-codes';
import { AppException } from '../src/common/exceptions/app.exception';
import { ExercisesSeeder, loadSeedFile } from '../src/modules/exercises/exercises.seeder';
import { MediaService } from '../src/modules/media/media.service';
import { PlansService } from '../src/modules/plans/plans.service';
import { createTestApp, createTestUser } from './utils/create-test-app';

interface AdminGuide {
  id: string;
  kind: string;
  publicId: string;
  format: string;
  caption: Record<string, string>;
  url: string;
}
interface GuidesBody {
  guidesPerRoutine: number | null;
  items: {
    exerciseId: string;
    guides: { id: string; kind: string; url: string; caption: string }[];
  }[];
  lockedExerciseIds: string[];
}

const INVALID_PREFIX = 'invalid/';
const GIF_MARK = '-gif';

describe('Exercise guides (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let admin: string;
  let premium: string;
  let destroyed: string[];
  let destroyFails: boolean;
  /** Global exercise ids, stable order. */
  let ex: string[];

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test, lang = 'es') =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', lang);
  const publicId = (mark = '') => `gymapp/test/exercises/guides/${randomUUID()}${mark}`;
  const putGuides = (exerciseId: string, guides: object[], token = admin) =>
    as(token, http().put(`/api/v1/admin/exercises/${exerciseId}/guides`)).send({ guides });
  const guidesOf = async (token: string, lang = 'es') =>
    (await as(token, http().get('/api/v1/guides'), lang).expect(200)).body as GuidesBody;
  const unlocked = (body: GuidesBody) => body.items.map((i) => i.exerciseId).sort();
  const routine = (token: string, exerciseIds: string[]) =>
    as(token, http().post('/api/v1/routines'))
      .send({
        name: 'Guides',
        exercises: exerciseIds.map((exerciseId) => ({
          exerciseId,
          sets: [{ type: 'normal', repsMin: 8, repsMax: 10 }],
        })),
      })
      .expect(201)
      .then((res) => (res.body as { id: string }).id);

  beforeAll(async () => {
    destroyed = [];
    destroyFails = false;
    ({ app } = await createTestApp((builder) =>
      builder.overrideProvider(MediaService).useValue({
        // Cloudinary is never called: the fake reports what the Admin API would.
        verifyGuideAsset: (id: string) =>
          id.startsWith(INVALID_PREFIX)
            ? Promise.reject(
                new AppException(ErrorCode.INVALID_GUIDE_ASSET, HttpStatus.BAD_REQUEST, {
                  details: { reason: 'size' },
                }),
              )
            : Promise.resolve(
                id.endsWith(GIF_MARK)
                  ? { kind: 'animation', format: 'gif', width: 480, height: 480, bytes: 900_000 }
                  : { kind: 'image', format: 'png', width: 800, height: 600, bytes: 120_000 },
              ),
        destroyGuide: (id: string) =>
          destroyFails
            ? Promise.reject(new Error('cloudinary down'))
            : Promise.resolve(void destroyed.push(id)),
        guideUrl: (id: string, format: string) => `https://cdn.test/${id}.${format}`,
        createUploadSignature: () => {
          throw new Error('not used');
        },
      }),
    ));
    db = app.get<Connection>(getConnectionToken());
    await app.get(ExercisesSeeder).run(loadSeedFile(), { update: false });
    ex = (
      await db
        .collection('exercises')
        .find({ isGlobal: true, deletedAt: null })
        .sort({ slug: 1 })
        .limit(10)
        .toArray()
    ).map((doc) => doc._id as unknown as string);

    premium = (await createTestUser(app, { premium: true })).token;
    const adminUser = await createTestUser(app);
    await db
      .collection('users')
      .updateOne({ _id: adminUser.id as never }, { $set: { role: 'admin' } });
    admin = await app
      .get(JwtService)
      .signAsync({ sub: adminUser.id, role: 'admin', sid: randomUUID() });

    // ex[0..7] get one guide each; ex[8], ex[9] have none.
    for (const id of ex.slice(0, 8)) {
      await putGuides(id, [
        { publicId: publicId(), caption: { es: 'Paso 1', en: 'Step 1' } },
      ]).expect(200);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('admin', () => {
    it('stores verified metadata (never client values), in the order sent', async () => {
      const gif = publicId(GIF_MARK);
      const png = publicId();
      const res = await putGuides(ex[8]!, [
        { publicId: gif, caption: { es: 'Baja', en: 'Lower' } },
        { publicId: png },
      ]).expect(200);
      const guides = (res.body as { guides: AdminGuide[] }).guides;
      expect(guides).toMatchObject([
        { publicId: gif, kind: 'animation', format: 'gif', caption: { es: 'Baja', en: 'Lower' } },
        { publicId: png, kind: 'image', format: 'png', caption: {} },
      ]);
      expect(guides[0]!.url).toBe(`https://cdn.test/${gif}.gif`);

      // Client-provided metadata is rejected by strict validation (whitelist).
      await putGuides(ex[8]!, [{ publicId: png, kind: 'animation' }]).expect(400);

      // Cleanup: ex[8] stays without guides for the access tests.
      await putGuides(ex[8]!, []).expect(200);
    });

    it('keeps id and metadata of kept files; destroys removed ones after saving', async () => {
      const a = publicId(GIF_MARK);
      const b = publicId();
      const first = await putGuides(ex[9]!, [{ publicId: a }, { publicId: b }]).expect(200);
      const [ga] = (first.body as { guides: AdminGuide[] }).guides;

      const second = await putGuides(ex[9]!, [{ publicId: a, caption: { es: 'Nuevo' } }]).expect(
        200,
      );
      expect((second.body as { guides: AdminGuide[] }).guides).toEqual([
        { ...ga, caption: { es: 'Nuevo' } },
      ]);
      expect(destroyed).toContain(b);
      expect(destroyed).not.toContain(a);

      await putGuides(ex[9]!, []).expect(200);
    });

    it('never destroys a file another exercise still uses; a failed destroy is not an error', async () => {
      const shared = publicId();
      await putGuides(ex[8]!, [{ publicId: shared }]).expect(200);
      await putGuides(ex[9]!, [{ publicId: shared }]).expect(200);
      await putGuides(ex[9]!, []).expect(200);
      expect(destroyed).not.toContain(shared);

      destroyFails = true;
      await putGuides(ex[8]!, []).expect(200);
      destroyFails = false;
    });

    it('rejects bad assets, duplicates, too many files, non-admins and unknown exercises', async () => {
      const before = await db.collection('exercises').findOne({ _id: ex[0] as never });

      const bad = await putGuides(ex[0]!, [
        { publicId: `${INVALID_PREFIX}${randomUUID()}` },
      ]).expect(400);
      expect(bad.body).toMatchObject({ code: 'INVALID_GUIDE_ASSET', details: { reason: 'size' } });

      const same = publicId();
      await putGuides(ex[0]!, [{ publicId: same }, { publicId: same }]).expect(400);
      await putGuides(
        ex[0]!,
        Array.from({ length: 7 }, () => ({ publicId: publicId() })),
      ).expect(400);
      await putGuides(ex[0]!, [{ publicId: publicId(), caption: { en: 'no es' } }]).expect(400);

      await putGuides(ex[0]!, [], premium).expect(403);
      const missing = await putGuides(randomUUID(), []).expect(404);
      expect(missing.body.code).toBe('EXERCISE_NOT_FOUND');

      const after = await db.collection('exercises').findOne({ _id: ex[0] as never });
      expect(after!.guides).toEqual(before!.guides);
    });
  });

  describe('catalog', () => {
    it('exposes only hasGuide — never guide files or URLs', async () => {
      const detail = await as(premium, http().get(`/api/v1/exercises/${ex[0]}`)).expect(200);
      expect(detail.body.hasGuide).toBe(true);
      expect(detail.body).not.toHaveProperty('guides');
      expect(detail.text).not.toContain('cdn.test');

      const plain = await as(premium, http().get(`/api/v1/exercises/${ex[9]}`)).expect(200);
      expect(plain.body.hasGuide).toBe(false);
    });
  });

  describe('access', () => {
    it('premium sees every guide without routines', async () => {
      const body = await guidesOf(premium, 'en');
      expect(body.guidesPerRoutine).toBeNull();
      expect(unlocked(body)).toEqual(ex.slice(0, 8).sort());
      expect(body.lockedExerciseIds).toEqual([]);
      expect(body.items[0]!.guides[0]).toMatchObject({ kind: 'image', caption: 'Step 1' });
      expect(body.items[0]!.guides[0]!.url).toMatch(/^https:\/\/cdn\.test\//);
    });

    it('free without routines: every guided exercise is locked', async () => {
      const { token } = await createTestUser(app);
      const body = await guidesOf(token);
      expect(body.guidesPerRoutine).toBe(5);
      expect(body.items).toEqual([]);
      expect([...body.lockedExerciseIds].sort()).toEqual(ex.slice(0, 8).sort());
    });

    it('free: first 5 guided exercises of each routine, in routine order', async () => {
      const { token } = await createTestUser(app);
      // ex[9] has no guide (doesn't use the quota); ex[0] repeated counts once.
      await routine(token, [ex[9]!, ex[0]!, ex[1]!, ex[0]!, ex[2]!, ex[3]!, ex[4]!, ex[5]!]);
      let body = await guidesOf(token);
      expect(unlocked(body)).toEqual(ex.slice(0, 5).sort());
      expect([...body.lockedExerciseIds].sort()).toEqual(ex.slice(5, 8).sort());

      // A second routine unlocks its own first 5 (archived routines count: programs use them).
      const second = await routine(token, [ex[7]!]);
      await as(token, http().post(`/api/v1/routines/${second}/archive`)).expect((res) =>
        expect(res.status).toBeLessThan(300),
      );
      body = await guidesOf(token);
      expect(unlocked(body)).toContain(ex[7]);

      // Deleted routines don't.
      await as(token, http().delete(`/api/v1/routines/${second}`)).expect(204);
      body = await guidesOf(token);
      expect(unlocked(body)).not.toContain(ex[7]);
    });

    it("the plan's value applies (admin-editable, not a constant)", async () => {
      const { token } = await createTestUser(app);
      await routine(token, ex.slice(0, 5));
      const plans = db.collection('plans');
      await plans.updateOne({ code: 'free' }, { $set: { 'entitlements.guidesPerRoutine': 2 } });
      try {
        expect(unlocked(await guidesOf(token))).toEqual(ex.slice(0, 2).sort());
      } finally {
        await plans.updateOne({ code: 'free' }, { $set: { 'entitlements.guidesPerRoutine': 5 } });
      }
    });

    it('one user’s routines never unlock guides for another', async () => {
      const bob = await createTestUser(app);
      const alice = await createTestUser(app);
      await routine(bob.token, [ex[6]!]);
      expect(unlocked(await guidesOf(bob.token))).toEqual([ex[6]]);
      expect(await guidesOf(alice.token)).toMatchObject({ items: [] });
    });
  });

  describe('resolve (session without a routine)', () => {
    it('unlocks the first N guided of the request on top of the routines; answers only for them', async () => {
      const { token } = await createTestUser(app);
      await routine(token, [ex[7]!]);
      const sent = [ex[9]!, ex[0]!, ex[1]!, ex[2]!, ex[3]!, ex[4]!, ex[5]!, ex[7]!];
      const res = await as(token, http().post('/api/v1/guides/resolve'))
        .send({ exerciseIds: sent })
        .expect(200);
      const body = res.body as GuidesBody;
      expect(unlocked(body)).toEqual([...ex.slice(0, 5), ex[7]!].sort());
      expect(body.lockedExerciseIds).toEqual([ex[5]]);
      expect(body.items.map((i) => i.exerciseId)).not.toContain(ex[6]);

      // Nothing is persisted: GET /guides still reflects routines only.
      expect(unlocked(await guidesOf(token))).toEqual([ex[7]]);
    });

    it('validates the payload', async () => {
      const { token } = await createTestUser(app);
      await as(token, http().post('/api/v1/guides/resolve')).send({ exerciseIds: [] }).expect(400);
      await as(token, http().post('/api/v1/guides/resolve'))
        .send({ exerciseIds: ['nope'] })
        .expect(400);
    });
  });

  describe('plans', () => {
    interface PlanDoc {
      code: string;
      entitlements: { guidesPerRoutine?: number | null };
    }
    const plans = () => db.collection<PlanDoc>('plans');
    const value = async (code: string) =>
      (await plans().findOne({ code }))!.entitlements.guidesPerRoutine;

    it('backfill sets plans that lack the key (premium unlimited, others 5) and respects edits', async () => {
      await plans().updateMany(
        { code: { $in: ['free', 'premium'] } },
        { $unset: { 'entitlements.guidesPerRoutine': '' } },
      );
      const service = app.get(PlansService);
      expect(await service.backfillGuidesPerRoutine(5, ['premium'])).toBe(2);
      expect(await value('free')).toBe(5);
      expect(await value('premium')).toBeNull();
      expect(await service.backfillGuidesPerRoutine(5, ['premium'])).toBe(0);

      await plans().updateOne({ code: 'free' }, { $set: { 'entitlements.guidesPerRoutine': 3 } });
      expect(await service.backfillGuidesPerRoutine(5, ['premium'])).toBe(0);
      expect(await value('free')).toBe(3);
      await plans().updateOne({ code: 'free' }, { $set: { 'entitlements.guidesPerRoutine': 5 } });
    });

    it('an entitlements update without the field keeps it; null = unlimited', async () => {
      const list = await as(admin, http().get('/api/v1/admin/plans')).expect(200);
      const free = (list.body as { id: string; code: string; entitlements: object }[]).find(
        (p) => p.code === 'free',
      )!;
      // A client that predates the field sends entitlements without it.
      const legacy: Record<string, unknown> = { ...free.entitlements };
      delete legacy.guidesPerRoutine;
      await as(admin, http().patch(`/api/v1/admin/plans/${free.id}`))
        .send({ entitlements: legacy })
        .expect(200);
      expect(await value('free')).toBe(5);

      const res = await as(admin, http().patch(`/api/v1/admin/plans/${free.id}`))
        .send({ entitlements: { ...legacy, guidesPerRoutine: null } })
        .expect(200);
      expect(res.body.entitlements.guidesPerRoutine).toBeNull();
      await plans().updateOne({ code: 'free' }, { $set: { 'entitlements.guidesPerRoutine': 5 } });
    });
  });
});
