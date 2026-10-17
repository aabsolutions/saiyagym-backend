/**
 * `npm run db:indexes`             → dry run: per collection, indexes the schemas define but the DB
 *                                    lacks (toCreate) and DB indexes no schema defines (toDrop)
 * `npm run db:indexes -- --apply`  → Model.syncIndexes(): creates missing, DROPS the extra ones
 *
 * Mongoose creates indexes at startup but never drops them; run this after removing an index from
 * a schema (see docs/INDEXES.md). Uses MONGODB_URI like the app — double-check where it points.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../app.module';

async function syncIndexes(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const logger = new Logger('DbIndexes');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const db = app.get<Connection>(getConnectionToken());
    for (const model of Object.values(db.models)) {
      const name = model.collection.collectionName;
      const { toDrop, toCreate } = await model.diffIndexes();
      if (!toDrop.length && !toCreate.length) continue;
      logger.log(`${name}: toCreate=${JSON.stringify(toCreate)} toDrop=${JSON.stringify(toDrop)}`);
      if (apply) {
        const dropped = await model.syncIndexes();
        logger.warn(`${name}: dropped ${JSON.stringify(dropped)}`);
      }
    }
    logger.log(apply ? 'Indexes synced.' : 'Dry run. Re-run with -- --apply to drop extras.');
  } finally {
    await app.close();
  }
}

syncIndexes().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
