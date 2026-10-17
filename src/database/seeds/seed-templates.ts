/**
 * `npm run seed:templates`            → insert missing program templates
 * `npm run seed:templates -- --update` → also overwrite existing, non-deleted ones
 * Requires the exercise catalog (`npm run seed:exercises`) — templates reference exercise slugs.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import {
  loadTemplatesSeed,
  ProgramTemplatesSeeder,
} from '../../modules/programs/templates/program-templates.seeder';

async function seedTemplates(): Promise<void> {
  const update = process.argv.includes('--update');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(ProgramTemplatesSeeder).run(loadTemplatesSeed(), { update });
    new Logger('SeedTemplates').log(
      `Done (${update ? 'update' : 'insert-only'}): ${JSON.stringify(report)}`,
    );
  } finally {
    await app.close();
  }
}

seedTemplates().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
