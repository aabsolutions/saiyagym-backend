import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { App } from 'supertest/types';
import { PlansService } from '../src/modules/plans/plans.service';
import { createTestApp } from './utils/create-test-app';

describe('db:backfill-premium-sounds (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let plans: PlansService;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<Connection>(getConnectionToken());
    plans = app.get(PlansService);
  });

  afterAll(async () => {
    await app.close();
  });

  interface PlanDoc {
    code: string;
    entitlements: { features: Record<string, boolean | undefined> };
  }
  const collection = () => db.collection<PlanDoc>('plans');
  const flag = async (code: string) =>
    (await collection().findOne({ code }))!.entitlements.features['premiumSounds'];

  it('enables the feature only on premium plans that lack the key; second run changes nothing', async () => {
    // Plans created before the feature existed: the key is absent.
    await collection().updateMany(
      { code: { $in: ['free', 'premium'] } },
      { $unset: { 'entitlements.features.premiumSounds': '' } },
    );
    const custom = `custom-${randomUUID().slice(0, 8)}`;
    await collection().insertOne({
      _id: randomUUID(),
      code: custom,
      entitlements: { features: { progressPhotos: true } },
    } as never);

    expect(await plans.backfillFeature('premiumSounds', ['premium'])).toBe(3);
    expect(await flag('premium')).toBe(true);
    expect(await flag('free')).toBe(false);
    expect(await flag(custom)).toBe(false);

    expect(await plans.backfillFeature('premiumSounds', ['premium'])).toBe(0);
    expect(await flag('premium')).toBe(true);
  });

  it('never overrides a value an admin already set', async () => {
    await collection().updateOne(
      { code: 'free' },
      { $set: { 'entitlements.features.premiumSounds': true } },
    );
    await collection().updateOne(
      { code: 'premium' },
      { $set: { 'entitlements.features.premiumSounds': false } },
    );

    expect(await plans.backfillFeature('premiumSounds', ['premium'])).toBe(0);
    expect(await flag('free')).toBe(true);
    expect(await flag('premium')).toBe(false);
  });
});
