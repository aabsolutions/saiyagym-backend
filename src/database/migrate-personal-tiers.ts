/**
 * `npm run db:migrate-personal-tiers` → one-off: user_exercise_prefs.personalTier (one tier for
 * every goal) becomes personalTiers { hypertrophy, powerlifting }, both set to the old value.
 * Idempotent; a no-op on databases created after the change.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ExercisePrefsService } from '../modules/exercises/exercise-prefs.service';

async function migrate(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    await app.get(ExercisePrefsService).migratePersonalTiers();
    new Logger('MigratePersonalTiers').log('Done');
  } finally {
    await app.close();
  }
}

migrate().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
