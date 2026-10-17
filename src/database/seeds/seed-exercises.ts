/**
 * `npm run seed:exercises`            → insert missing tags/exercises (existing ones untouched)
 * `npm run seed:exercises -- --update` → also overwrite existing, non-deleted ones from the JSON
 * Data: src/database/seeds/exercises.seed.json. Upsert key: `slug`.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { ExercisesSeeder, loadSeedFile } from '../../modules/exercises/exercises.seeder';

async function seedExercises(): Promise<void> {
  const update = process.argv.includes('--update');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(ExercisesSeeder).run(loadSeedFile(), { update });
    new Logger('SeedExercises').log(
      `Done (${update ? 'update' : 'insert-only'}): ${JSON.stringify(report)}`,
    );
  } finally {
    await app.close();
  }
}

seedExercises().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
