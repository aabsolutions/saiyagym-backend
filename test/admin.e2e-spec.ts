import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, uniqueEmail } from './utils/create-test-app';

describe('Admin: users, roles & plans (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let userToken: string;
  let userId: string;
  let adminId: string;
  const userEmail = uniqueEmail('member');
  const password = 'secret-pass-1';

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    ({ app } = await createTestApp());

    const adminEmail = uniqueEmail('admin');
    const admin = await http()
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password })
      .expect(201);
    adminId = admin.body.user.id;
    await app
      .get<Connection>(getConnectionToken())
      .collection('users')
      .updateOne({ _id: adminId as never }, { $set: { role: 'admin' } });
    // Role is embedded in the access token → log in again after promoting.
    adminToken = (
      await http().post('/api/v1/auth/login').send({ email: adminEmail, password }).expect(200)
    ).body.tokens.accessToken;

    const user = await http()
      .post('/api/v1/auth/register')
      .send({ email: userEmail, password, name: 'Bruno Member' })
      .expect(201);
    userId = user.body.user.id;
    userToken = user.body.tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists users with pagination and search (by email or name)', async () => {
    const byName = await asAdmin(http().get('/api/v1/admin/users?search=bruno&limit=5')).expect(
      200,
    );
    expect(byName.body.meta).toMatchObject({ page: 1, limit: 5 });
    expect(byName.body.items.map((u: { id: string }) => u.id)).toContain(userId);

    // Regex metacharacters are escaped, not interpreted.
    const weird = await asAdmin(http().get('/api/v1/admin/users?search=.*')).expect(200);
    expect(weird.body.items).toHaveLength(0);
  });

  it('changes another user’s role but not its own', async () => {
    await asAdmin(http().patch(`/api/v1/admin/users/${userId}/role`))
      .send({ role: 'coach' })
      .expect(200)
      .expect(({ body }) => expect(body.role).toBe('coach'));

    const own = await asAdmin(http().patch(`/api/v1/admin/users/${adminId}/role`))
      .send({ role: 'user' })
      .expect(400);
    expect(own.body.code).toBe('CANNOT_CHANGE_OWN_ROLE');
  });

  it('assigns a plan; the user’s effective entitlements follow', async () => {
    const plans = await asAdmin(http().get('/api/v1/admin/plans')).expect(200);
    const premium = (plans.body as { id: string; code: string }[]).find(
      (p) => p.code === 'premium',
    )!;

    await asAdmin(http().put(`/api/v1/admin/users/${userId}/subscription`))
      .send({ planId: premium.id })
      .expect(200);

    const me = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Accept-Language', 'en')
      .expect(200);
    expect(me.body.plan).toMatchObject({ code: 'premium', name: 'Premium' });
    expect(me.body.plan.entitlements.limits.routines).toBeNull();
    expect(me.body.plan.entitlements.features.progressPhotos).toBe(true);
  });

  it('plans CRUD: create, update, soft delete; the default plan is protected', async () => {
    const payload = {
      code: 'pro-test',
      name: { es: 'Pro', en: 'Pro' },
      entitlements: {
        limits: { routines: 10, activePrograms: 2, customExercises: null },
        statsHistoryDays: 365,
        features: {
          progressPhotos: true,
          autoProgression: false,
          fullStats: true,
          fullNutrition: false,
          dataExport: false,
        },
      },
    };
    const created = await asAdmin(http().post('/api/v1/admin/plans')).send(payload).expect(201);

    const dup = await asAdmin(http().post('/api/v1/admin/plans')).send(payload).expect(409);
    expect(dup.body.code).toBe('PLAN_CODE_TAKEN');

    await asAdmin(http().patch(`/api/v1/admin/plans/${created.body.id}`))
      .send({ name: { es: 'Pro+', en: 'Pro+' } })
      .expect(200)
      .expect(({ body }) => expect(body.name.es).toBe('Pro+'));

    await asAdmin(http().delete(`/api/v1/admin/plans/${created.body.id}`)).expect(204);
    await asAdmin(http().get(`/api/v1/admin/plans/${created.body.id}`)).expect(404);

    const plans = await asAdmin(http().get('/api/v1/admin/plans')).expect(200);
    const free = (plans.body as { id: string; code: string }[]).find((p) => p.code === 'free')!;
    const res = await asAdmin(http().delete(`/api/v1/admin/plans/${free.id}`)).expect(409);
    expect(res.body.code).toBe('PLAN_IS_DEFAULT');
  });

  it('rejects plan payloads without the mandatory `es` translation', async () => {
    const res = await asAdmin(http().post('/api/v1/admin/plans'))
      .send({
        code: 'no-es',
        name: { en: 'Only English' },
        entitlements: {
          limits: { routines: 1, activePrograms: 1, customExercises: 1 },
          statsHistoryDays: 30,
          features: {
            progressPhotos: false,
            autoProgression: false,
            fullStats: false,
            fullNutrition: false,
            dataExport: false,
          },
        },
      })
      .expect(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
    );
  });

  it('exposes the public plan catalog without auth, localized', async () => {
    const res = await http().get('/api/v1/plans').set('Accept-Language', 'en').expect(200);
    const codes = (res.body as { code: string }[]).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['free', 'premium']));
    expect(
      (res.body as { code: string; name: string }[]).find((p) => p.code === 'free')!.name,
    ).toBe('Free');
  });
});
