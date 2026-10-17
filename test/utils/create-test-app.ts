import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { UsersService } from '../../src/modules/users/users.service';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/app.setup';
import { MailMessage, MailService } from '../../src/modules/mail/mail.service';

export interface TestApp {
  app: INestApplication<App>;
  /** Emails "sent" by the app, newest last. */
  outbox: MailMessage[];
}

/**
 * Boots the real AppModule (same HTTP setup as main.ts) with an in-memory mail outbox.
 * `overrides` lets a test file swap providers (e.g. a MediaService with fake credentials).
 */
export async function createTestApp(
  overrides: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<TestApp> {
  const outbox: MailMessage[] = [];
  const moduleRef = await overrides(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: (message: MailMessage) => Promise.resolve(void outbox.push(message)) }),
  ).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  setupApp(app);
  await app.init();
  return { app, outbox };
}

/**
 * Creates a user through the real UsersService (default plan, defaults) and signs an access token,
 * bypassing POST /auth/register — whose production rate limit (5/hour/IP) a test file creating many
 * users would hit. Use register() over HTTP when the auth flow itself is under test.
 */
export async function createTestUser(
  app: INestApplication,
  options: { premium?: boolean; email?: string } = {},
): Promise<{ id: string; token: string }> {
  const user = await app.get(UsersService).create({
    email: options.email ?? uniqueEmail('user'),
    passwordHash: 'not-used-in-token-based-tests',
  });
  if (options.premium) {
    const db = app.get<Connection>(getConnectionToken());
    const plan = await db.collection('plans').findOne({ code: 'premium' });
    await db
      .collection('users')
      .updateOne({ _id: user._id as never }, { $set: { 'subscription.planId': plan!._id } });
  }
  const token = await app
    .get(JwtService)
    .signAsync({ sub: user._id, role: user.role, sid: randomUUID() });
  return { id: user._id, token };
}

/** Unique per run so test files sharing the e2e database never collide. */
export const uniqueEmail = (prefix: string): string =>
  `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
