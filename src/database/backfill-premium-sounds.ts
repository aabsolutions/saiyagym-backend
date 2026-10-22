/**
 * `npm run db:backfill-premium-sounds` → one-off after deploying rest-alarm sounds: plans created
 * before the feature have no `entitlements.features.premiumSounds`. Sets it true on the `premium`
 * plan and false elsewhere, ONLY where the key is absent. Idempotent; respects admin edits.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PlansService } from '../modules/plans/plans.service';

async function backfill(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const changed = await app.get(PlansService).backfillFeature('premiumSounds', ['premium']);
    new Logger('BackfillPremiumSounds').log(`Done (${changed} plans updated)`);
  } finally {
    await app.close();
  }
}

backfill().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
