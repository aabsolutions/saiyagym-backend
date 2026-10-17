/**
 * `npm run seed:nutrition`            → insert missing foods/meal suggestions/guidelines
 * `npm run seed:nutrition -- --update` → also overwrite existing, non-deleted ones from the JSON
 * Data: src/database/seeds/nutrition.seed.json. Upsert key: `slug`.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { loadNutritionSeed, NutritionSeeder } from '../../modules/nutrition/nutrition.seeder';

async function seedNutrition(): Promise<void> {
  const update = process.argv.includes('--update');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(NutritionSeeder).run(loadNutritionSeed(), { update });
    new Logger('SeedNutrition').log(
      `Done (${update ? 'update' : 'insert-only'}): ${JSON.stringify(report)}`,
    );
  } finally {
    await app.close();
  }
}

seedNutrition().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
