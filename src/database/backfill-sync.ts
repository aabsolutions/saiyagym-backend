/**
 * `npm run db:backfill-sync` → one-off: sets `serverUpdatedAt` (the sync pull cursor) on documents
 * written before syncTrackingPlugin existed. Idempotent; a no-op on databases created afterwards.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SyncService } from '../modules/sync/sync.service';

async function backfill(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    await app.get(SyncService).backfillServerUpdatedAt();
    new Logger('BackfillSync').log('Done');
  } finally {
    await app.close();
  }
}

backfill().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
