import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';

// MONGODB_URI (a database private to this file) comes from test/setup-isolated-db.ts.
describe('Health & error contract (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with MongoDB up', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.info.mongodb.status).toBe('up');
    });

    it('returns 503 in the error envelope when MongoDB is down', async () => {
      const connection = app.get<Connection>(getConnectionToken());
      await connection.close();
      try {
        const res = await request(app.getHttpServer())
          .get('/api/v1/health')
          .set('Accept-Language', 'en')
          .expect(503);

        expect(res.body).toMatchObject({
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'The service is temporarily unavailable.',
        });
        expect(res.body.details.error.mongodb.status).toBe('down');
      } finally {
        await connection.openUri(process.env.MONGODB_URI!);
      }
    });
  });

  describe('error envelope i18n', () => {
    it('translates by Accept-Language with stable code', async () => {
      const es = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
      const en = await request(app.getHttpServer())
        .get('/api/v1/nope')
        .set('Accept-Language', 'en-US,en;q=0.9')
        .expect(404);

      expect(es.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'El recurso solicitado no existe.',
      });
      expect(en.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'The requested resource does not exist.',
      });
    });

    it('falls back to es for unsupported languages', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/nope')
        .set('Accept-Language', 'fr')
        .expect(404);

      expect(res.body.message).toBe('El recurso solicitado no existe.');
    });
  });
});
