/**
 * `npm run openapi` → writes ./openapi.json (consumed by the web and mobile clients).
 * Runs Nest in preview mode: modules are scanned but no provider is instantiated,
 * so it needs neither MongoDB nor a real .env.
 */
// MUST stay the first import: ConfigModule validates env when AppModule is imported.
import './openapi.env';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, createOpenApiDocument } from './app.setup';

async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: ['error'] });
  app.setGlobalPrefix(API_PREFIX);

  const outFile = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outFile, `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI spec written to ${outFile}`);
}

void generate();
