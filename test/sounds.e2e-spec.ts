import { randomUUID } from 'node:crypto';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ErrorCode } from '../src/common/constants/error-codes';
import { AppException } from '../src/common/exceptions/app.exception';
import { MediaService } from '../src/modules/media/media.service';
import { createTestApp, createTestUser } from './utils/create-test-app';

interface AdminSound {
  id: string;
  slug: string;
  name: { es: string; en: string };
  access: string;
  publicId: string;
  bytes: number;
  durationSec: number;
  format: string;
}
interface UserSound {
  id: string;
  slug: string;
  name: string;
  access: string;
  locked: boolean;
  wavUrl: string | null;
  mp3Url: string | null;
}

const INVALID_PREFIX = 'invalid/';

describe('Rest sounds (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let free: { id: string; token: string };
  let premium: { id: string; token: string };
  let admin: string;
  let destroyed: string[];
  let destroyFails: boolean;

  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test, lang = 'es') =>
    req.set('Authorization', `Bearer ${token}`).set('Accept-Language', lang);
  const publicId = () => `gymapp/test/sounds/${randomUUID()}`;
  const suffix = () => Math.random().toString(36).slice(2, 8);
  const createSound = (body: object, token = admin) =>
    as(token, http().post('/api/v1/admin/sounds')).send(body);
  const sound = (access: 'free' | 'premium', extra: object = {}) => ({
    slug: `snd-${suffix()}`,
    name: { es: 'Campana', en: 'Bell' },
    access,
    publicId: publicId(),
    ...extra,
  });

  beforeAll(async () => {
    destroyed = [];
    destroyFails = false;
    ({ app } = await createTestApp((builder) =>
      builder.overrideProvider(MediaService).useValue({
        // Cloudinary is never called: the fake reports what the Admin API would.
        verifySoundAsset: (id: string) =>
          id.startsWith(INVALID_PREFIX)
            ? Promise.reject(
                new AppException(ErrorCode.INVALID_SOUND_ASSET, HttpStatus.BAD_REQUEST, {
                  details: { reason: 'size' },
                }),
              )
            : Promise.resolve({ bytes: 123_456, durationSec: 4.2, format: 'mp3' }),
        destroySound: (id: string) =>
          destroyFails
            ? Promise.reject(new Error('cloudinary down'))
            : Promise.resolve(void destroyed.push(id)),
        // MediaController is part of AppModule: unused here.
        createUploadSignature: () => {
          throw new Error('not used');
        },
      }),
    ));
    db = app.get<Connection>(getConnectionToken());

    free = await createTestUser(app);
    premium = await createTestUser(app, { premium: true });
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

  describe('admin CRUD', () => {
    it('creates a sound with bytes/duration/format read from the verified asset', async () => {
      const body = sound('free');
      const res = await createSound({ ...body, bytes: 1, durationSec: 1 })
        // Client-provided metrics are rejected by strict validation (whitelist).
        .expect(400);
      expect(res.body.code).toBeDefined();

      const created = await createSound(body).expect(201);
      const dto = created.body as AdminSound;
      expect(dto).toMatchObject({
        slug: body.slug,
        name: body.name,
        access: 'free',
        publicId: body.publicId,
        bytes: 123_456,
        durationSec: 4.2,
        format: 'mp3',
      });
    });

    it('rejects an invalid asset with 400 INVALID_SOUND_ASSET and stores nothing', async () => {
      const body = sound('free', { publicId: `${INVALID_PREFIX}${randomUUID()}` });
      const res = await createSound(body).expect(400);
      expect(res.body.code).toBe('INVALID_SOUND_ASSET');
      expect(await db.collection('rest_sounds').countDocuments({ slug: body.slug })).toBe(0);
    });

    it('forbids non-admins on every /admin/sounds route (403)', async () => {
      const body = sound('free');
      const id = randomUUID();
      await createSound(body, free.token).expect(403);
      await as(free.token, http().get('/api/v1/admin/sounds')).expect(403);
      await as(free.token, http().get(`/api/v1/admin/sounds/${id}`)).expect(403);
      await as(free.token, http().patch(`/api/v1/admin/sounds/${id}`))
        .send({ sortOrder: 1 })
        .expect(403);
      await as(free.token, http().delete(`/api/v1/admin/sounds/${id}`)).expect(403);
    });

    it('requires authentication on /admin/sounds', async () => {
      await http().get('/api/v1/admin/sounds').expect(401);
    });

    it('409 SOUND_SLUG_TAKEN for a duplicate slug', async () => {
      const body = sound('free');
      await createSound(body).expect(201);
      const res = await createSound({ ...body, publicId: publicId() }).expect(409);
      expect(res.body.code).toBe('SOUND_SLUG_TAKEN');
    });

    it('updates fields and re-verifies only when the publicId changes', async () => {
      const created = (await createSound(sound('free')).expect(201)).body as AdminSound;

      const renamed = await as(admin, http().patch(`/api/v1/admin/sounds/${created.id}`))
        .send({ name: { es: 'Gong', en: 'Gong' }, access: 'premium', sortOrder: 5 })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: { es: 'Gong', en: 'Gong' }, access: 'premium' });
      expect(renamed.body.publicId).toBe(created.publicId);

      const bad = await as(admin, http().patch(`/api/v1/admin/sounds/${created.id}`))
        .send({ publicId: `${INVALID_PREFIX}${randomUUID()}` })
        .expect(400);
      expect(bad.body.code).toBe('INVALID_SOUND_ASSET');
      const unchanged = await as(admin, http().get(`/api/v1/admin/sounds/${created.id}`)).expect(
        200,
      );
      expect(unchanged.body.publicId).toBe(created.publicId);
    });

    it('soft delete hides the sound and keeps its slug reserved', async () => {
      const body = sound('free');
      const created = (await createSound(body).expect(201)).body as AdminSound;

      await as(admin, http().delete(`/api/v1/admin/sounds/${created.id}`)).expect(204);

      const stored = await db.collection('rest_sounds').findOne({ _id: created.id as never });
      expect(stored?.deletedAt).toBeTruthy();
      await as(admin, http().get(`/api/v1/admin/sounds/${created.id}`)).expect(404);
      const list = await as(admin, http().get('/api/v1/admin/sounds?limit=100')).expect(200);
      expect((list.body.items as AdminSound[]).map((s) => s.id)).not.toContain(created.id);
      const reuse = await createSound({ ...body, publicId: publicId() }).expect(409);
      expect(reuse.body.code).toBe('SOUND_SLUG_TAKEN');
    });
  });

  describe('Cloudinary asset cleanup', () => {
    const del = (id: string) => as(admin, http().delete(`/api/v1/admin/sounds/${id}`));
    const patch = (id: string, body: object) =>
      as(admin, http().patch(`/api/v1/admin/sounds/${id}`)).send(body);

    beforeEach(() => {
      destroyed.length = 0;
      destroyFails = false;
    });

    it('delete destroys the asset after the soft delete', async () => {
      const body = sound('free');
      const created = (await createSound(body).expect(201)).body as AdminSound;
      await del(created.id).expect(204);
      expect(destroyed).toEqual([body.publicId]);
      const stored = await db.collection('rest_sounds').findOne({ _id: created.id as never });
      expect(stored?.deletedAt).toBeTruthy();
    });

    it('replacing the publicId destroys the old asset and keeps the new one', async () => {
      const body = sound('free');
      const created = (await createSound(body).expect(201)).body as AdminSound;
      const next = publicId();
      const res = await patch(created.id, { publicId: next }).expect(200);
      expect(res.body.publicId).toBe(next);
      expect(destroyed).toEqual([body.publicId]);
    });

    it('an update that keeps the same publicId destroys nothing', async () => {
      const body = sound('free');
      const created = (await createSound(body).expect(201)).body as AdminSound;
      await patch(created.id, { publicId: body.publicId, sortOrder: 3 }).expect(200);
      await patch(created.id, { sortOrder: 4 }).expect(200);
      expect(destroyed).toEqual([]);
    });

    it('does not destroy an asset another row (even soft-deleted) still references', async () => {
      const shared = publicId();
      const a = (await createSound(sound('free', { publicId: shared })).expect(201))
        .body as AdminSound;
      const b = (await createSound(sound('free', { publicId: shared })).expect(201))
        .body as AdminSound;
      await del(a.id).expect(204); // b still uses it
      expect(destroyed).toEqual([]);
      await del(b.id).expect(204); // a is soft-deleted but its row still references it
      expect(destroyed).toEqual([]);

      const c = (await createSound(sound('free')).expect(201)).body as AdminSound;
      const d = (await createSound(sound('free', { publicId: shared })).expect(201))
        .body as AdminSound;
      await patch(d.id, { publicId: publicId() }).expect(200);
      expect(destroyed).toEqual([]);
      await del(c.id).expect(204);
      expect(destroyed).toHaveLength(1);
    });

    it('a failing destroy never fails the request and the DB change persists', async () => {
      destroyFails = true;
      const first = (await createSound(sound('free')).expect(201)).body as AdminSound;
      const next = publicId();
      await patch(first.id, { publicId: next }).expect(200);
      const replaced = await db.collection('rest_sounds').findOne({ _id: first.id as never });
      expect(replaced?.publicId).toBe(next);

      await del(first.id).expect(204);
      const stored = await db.collection('rest_sounds').findOne({ _id: first.id as never });
      expect(stored?.deletedAt).toBeTruthy();
      expect(destroyed).toEqual([]);
    });

    it('a rejected replacement (invalid asset) destroys nothing', async () => {
      const created = (await createSound(sound('free')).expect(201)).body as AdminSound;
      await patch(created.id, { publicId: `${INVALID_PREFIX}${randomUUID()}` }).expect(400);
      expect(destroyed).toEqual([]);
    });
  });

  describe('GET /sounds', () => {
    let freeSound: AdminSound;
    let premiumSound: AdminSound;

    beforeAll(async () => {
      freeSound = (await createSound(sound('free', { sortOrder: -2 })).expect(201))
        .body as AdminSound;
      premiumSound = (await createSound(sound('premium', { sortOrder: -1 })).expect(201))
        .body as AdminSound;
    });

    const list = async (token: string, lang = 'es') =>
      (await as(token, http().get('/api/v1/sounds'), lang).expect(200)).body as {
        items: UserSound[];
      };

    it('requires authentication', async () => {
      await http().get('/api/v1/sounds').expect(401);
    });

    it('free user: premium sounds are locked and carry no URLs', async () => {
      const { items } = await list(free.token);
      const f = items.find((s) => s.id === freeSound.id)!;
      const p = items.find((s) => s.id === premiumSound.id)!;
      expect(f.locked).toBe(false);
      expect(f.wavUrl).toBeNull(); // no Cloudinary cloud name in the test env
      expect(p.locked).toBe(true);
      expect(p.wavUrl).toBeNull();
      expect(p.mp3Url).toBeNull();
    });

    it('premium user: nothing is locked', async () => {
      const { items } = await list(premium.token);
      expect(items.find((s) => s.id === premiumSound.id)!.locked).toBe(false);
      expect(items.every((s) => !s.locked)).toBe(true);
    });

    it('sorts by sortOrder and localizes the name by Accept-Language', async () => {
      const { items } = await list(free.token, 'en');
      const ids = items.map((s) => s.id);
      expect(ids.indexOf(freeSound.id)).toBeLessThan(ids.indexOf(premiumSound.id));
      expect(items[0]?.name).toBe('Bell');
      expect((await list(free.token, 'es')).items[0]?.name).toBe('Campana');
    });

    it('does not list soft-deleted sounds', async () => {
      const gone = (await createSound(sound('free')).expect(201)).body as AdminSound;
      await as(admin, http().delete(`/api/v1/admin/sounds/${gone.id}`)).expect(204);
      expect((await list(free.token)).items.map((s) => s.id)).not.toContain(gone.id);
    });
  });

  describe('PATCH /users/me restSoundId', () => {
    let freeSound: AdminSound;
    let premiumSound: AdminSound;

    beforeAll(async () => {
      freeSound = (await createSound(sound('free')).expect(201)).body as AdminSound;
      premiumSound = (await createSound(sound('premium')).expect(201)).body as AdminSound;
    });

    const setSound = (token: string, restSoundId: string | null, lang = 'es') =>
      as(token, http().patch('/api/v1/users/me'), lang).send({ preferences: { restSoundId } });
    const me = async (token: string) =>
      (await as(token, http().get('/api/v1/users/me')).expect(200)).body as {
        preferences: { restSoundId: string | null };
      };

    it('sets a free sound, then null clears it', async () => {
      const user = await createTestUser(app);
      const set = await setSound(user.token, freeSound.id).expect(200);
      expect(set.body.preferences.restSoundId).toBe(freeSound.id);
      expect((await me(user.token)).preferences.restSoundId).toBe(freeSound.id);

      await setSound(user.token, null).expect(200);
      expect((await me(user.token)).preferences.restSoundId).toBeNull();
    });

    it('403 PLAN_FEATURE_REQUIRED for a premium sound on a free plan; unchanged', async () => {
      const user = await createTestUser(app);
      await setSound(user.token, freeSound.id).expect(200);
      const res = await setSound(user.token, premiumSound.id).expect(403);
      expect(res.body.code).toBe('PLAN_FEATURE_REQUIRED');
      expect((await me(user.token)).preferences.restSoundId).toBe(freeSound.id);
    });

    it('premium user can pick a premium sound', async () => {
      const user = await createTestUser(app, { premium: true });
      await setSound(user.token, premiumSound.id).expect(200);
      expect((await me(user.token)).preferences.restSoundId).toBe(premiumSound.id);
    });

    it('SOUND_NOT_FOUND (404) for an unknown id, localized by Accept-Language', async () => {
      const user = await createTestUser(app);
      const es = await setSound(user.token, randomUUID(), 'es').expect(404);
      const en = await setSound(user.token, randomUUID(), 'en').expect(404);
      expect(es.body.code).toBe('SOUND_NOT_FOUND');
      expect(es.body.message).toBe('El sonido no existe.');
      expect(en.body.message).toBe('The sound does not exist.');
    });

    it('rejects a non-UUID restSoundId (400)', async () => {
      const user = await createTestUser(app);
      await setSound(user.token, 'not-a-uuid').expect(400);
    });

    it('effective id becomes null after the sound is deleted', async () => {
      const user = await createTestUser(app);
      const doomed = (await createSound(sound('free')).expect(201)).body as AdminSound;
      await setSound(user.token, doomed.id).expect(200);
      await as(admin, http().delete(`/api/v1/admin/sounds/${doomed.id}`)).expect(204);
      expect((await me(user.token)).preferences.restSoundId).toBeNull();
      // The stored value is not required to change.
      const stored = await db.collection('users').findOne({ _id: user.id as never });
      expect(stored?.preferences.restSoundId).toBe(doomed.id);
    });

    it('effective id becomes null on downgrade and returns on upgrade', async () => {
      const user = await createTestUser(app, { premium: true });
      await setSound(user.token, premiumSound.id).expect(200);

      const freePlan = await db.collection('plans').findOne({ code: 'free' });
      const premiumPlan = await db.collection('plans').findOne({ code: 'premium' });
      const assign = (planId: unknown) =>
        db
          .collection('users')
          .updateOne({ _id: user.id as never }, { $set: { 'subscription.planId': planId } });

      await assign(freePlan!._id);
      expect((await me(user.token)).preferences.restSoundId).toBeNull();
      await assign(premiumPlan!._id);
      expect((await me(user.token)).preferences.restSoundId).toBe(premiumSound.id);
    });
  });
  describe.each(['trainingReminderSoundId', 'weighInSoundId'] as const)(
    'PATCH /users/me %s',
    (key) => {
      let freeSound: AdminSound;
      let premiumSound: AdminSound;

      beforeAll(async () => {
        freeSound = (await createSound(sound('free')).expect(201)).body as AdminSound;
        premiumSound = (await createSound(sound('premium')).expect(201)).body as AdminSound;
      });

      const setSound = (token: string, value: string | null, lang = 'es') =>
        as(token, http().patch('/api/v1/users/me'), lang).send({ preferences: { [key]: value } });
      const me = async (token: string) =>
        (await as(token, http().get('/api/v1/users/me')).expect(200)).body as {
          preferences: Record<string, string | null>;
        };

      it('sets a free sound without touching the other sound preferences, null clears', async () => {
        const user = await createTestUser(app);
        const set = await setSound(user.token, freeSound.id).expect(200);
        expect(set.body.preferences[key]).toBe(freeSound.id);
        const got = (await me(user.token)).preferences;
        expect(got[key]).toBe(freeSound.id);
        expect(got.restSoundId).toBeNull();

        await setSound(user.token, null).expect(200);
        expect((await me(user.token)).preferences[key]).toBeNull();
      });

      it('404 SOUND_NOT_FOUND for an unknown id', async () => {
        const user = await createTestUser(app);
        const res = await setSound(user.token, randomUUID()).expect(404);
        expect(res.body.code).toBe('SOUND_NOT_FOUND');
      });

      it('403 PLAN_FEATURE_REQUIRED (premiumSounds) for a premium sound on a free plan', async () => {
        const user = await createTestUser(app);
        const res = await setSound(user.token, premiumSound.id).expect(403);
        expect(res.body.code).toBe('PLAN_FEATURE_REQUIRED');
        expect(res.body.details).toMatchObject({ feature: 'premiumSounds' });
        expect((await me(user.token)).preferences[key]).toBeNull();
      });

      it('premium user can pick a premium sound; downgrade makes the effective id null', async () => {
        const user = await createTestUser(app, { premium: true });
        await setSound(user.token, premiumSound.id).expect(200);
        expect((await me(user.token)).preferences[key]).toBe(premiumSound.id);

        const freePlan = await db.collection('plans').findOne({ code: 'free' });
        await db
          .collection('users')
          .updateOne({ _id: user.id as never }, { $set: { 'subscription.planId': freePlan!._id } });
        expect((await me(user.token)).preferences[key]).toBeNull();
      });

      it('effective id is null after the sound is soft-deleted', async () => {
        const user = await createTestUser(app);
        const doomed = (await createSound(sound('free')).expect(201)).body as AdminSound;
        await setSound(user.token, doomed.id).expect(200);
        await as(admin, http().delete(`/api/v1/admin/sounds/${doomed.id}`)).expect(204);
        expect((await me(user.token)).preferences[key]).toBeNull();
      });

      it('legacy users without the stored field read null (no backfill)', async () => {
        const user = await createTestUser(app);
        await db
          .collection('users')
          .updateOne({ _id: user.id as never }, { $unset: { [`preferences.${key}`]: '' } });
        expect((await me(user.token)).preferences[key]).toBeNull();
      });

      it('rejects a non-UUID value (400)', async () => {
        const user = await createTestUser(app);
        await setSound(user.token, 'not-a-uuid').expect(400);
      });
    },
  );
});
