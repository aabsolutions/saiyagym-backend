/**
 * `npm run seed` — idempotent, safe to run against any environment:
 * 1. Default plans (Free/Premium) via $setOnInsert — admin edits are never overwritten.
 * 2. Admin user from ADMIN_EMAIL + ADMIN_PASSWORD (skipped if unset). If the email already
 *    exists it's promoted to admin; its password is NOT changed.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { Role } from '../../common/constants/role';
import type { Env } from '../../config/env.schema';
import { PasswordHasher } from '../../modules/auth/password-hasher.service';
import { PlansService } from '../../modules/plans/plans.service';
import { UsersService } from '../../modules/users/users.service';

async function seed(): Promise<void> {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    await app.get(PlansService).ensureDefaultPlans();
    logger.log('Default plans ensured');

    const config = app.get<ConfigService<Env, true>>(ConfigService);
    const email = config.get('ADMIN_EMAIL', { infer: true });
    const password = config.get('ADMIN_PASSWORD', { infer: true });
    if (!email || !password) {
      logger.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin user');
      return;
    }

    const users = app.get(UsersService);
    const existing = await users.findActiveByEmail(email);
    if (existing) {
      if (existing.role !== Role.ADMIN) {
        existing.role = Role.ADMIN;
        await existing.save();
        logger.log(`Promoted existing user ${email} to admin (password unchanged)`);
      } else {
        logger.log(`Admin ${email} already exists — nothing to do`);
      }
      return;
    }

    await users.create({
      email,
      passwordHash: await app.get(PasswordHasher).hash(password),
      name: 'Admin',
      role: Role.ADMIN,
      emailVerifiedAt: new Date(),
    });
    logger.log(`Created admin ${email}`);
  } finally {
    await app.close();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
