import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, uniqueEmail } from './utils/create-test-app';

describe('Auth flow (e2e)', () => {
  let app: INestApplication<App>;
  const email = uniqueEmail('ana');
  const password = 'secret-pass-1';
  let refreshToken: string;
  let accessToken: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates the account on the Free plan and returns a session', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: email.toUpperCase(), password, name: 'Ana' })
        .expect(201);

      expect(res.body.tokens).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
      expect(res.body.user).toMatchObject({
        email, // normalized to lower case
        role: 'user',
        emailVerified: false,
        plan: { code: 'free', name: 'Gratis' },
      });
      expect(res.body.user.plan.entitlements.limits.routines).toBe(3);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a duplicate email with a stable code', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .set('Accept-Language', 'en')
        .send({ email, password })
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account with that email already exists.',
      });
    });

    it('validates input (short password, unknown fields)', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: uniqueEmail('x'), password: 'short', role: 'admin' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      const fields = (res.body.details as { field: string }[]).map((d) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['password', 'role']));
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in with valid credentials', async () => {
      const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
      ({ accessToken, refreshToken } = res.body.tokens);
      expect(res.body.user.email).toBe(email);
    });

    it('rejects invalid credentials with a generic error', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('protected routes', () => {
    it('GET /users/me works with the access token', async () => {
      const res = await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body).toMatchObject({ email, profile: { name: 'Ana' } });
    });

    it('rejects requests without a valid token', async () => {
      await http().get('/api/v1/users/me').expect(401);
      const res = await http()
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('non-admins get 403 on admin routes', async () => {
      const res = await http()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates: returns a new pair and invalidates the old refresh token', async () => {
      const first = refreshToken;
      const res = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(200);

      expect(res.body.refreshToken).not.toBe(first);
      refreshToken = res.body.refreshToken;

      await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      // Replaying the rotated token = theft signal → session revoked.
      const replay = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      const revoked = await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
      expect(revoked.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('logout ends the session', async () => {
      const login = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
      const token: string = login.body.tokens.refreshToken;

      await http().post('/api/v1/auth/logout').send({ refreshToken: token }).expect(204);
      await http().post('/api/v1/auth/refresh').send({ refreshToken: token }).expect(401);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated login attempts with 429', async () => {
      let status = 0;
      for (let attempt = 0; attempt < 10 && status !== 429; attempt++) {
        status = (await http().post('/api/v1/auth/login').send({ email, password: 'nope-nope' }))
          .status;
      }
      expect(status).toBe(429);
    });
  });
});
