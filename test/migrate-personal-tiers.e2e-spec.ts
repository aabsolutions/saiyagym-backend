import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { App } from 'supertest/types';
import { ExercisePrefsService } from '../src/modules/exercises/exercise-prefs.service';
import { createTestApp } from './utils/create-test-app';

describe('db:migrate-personal-tiers (e2e)', () => {
  let app: INestApplication<App>;
  let db: Connection;
  let prefs: ExercisePrefsService;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<Connection>(getConnectionToken());
    prefs = app.get(ExercisePrefsService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** user_exercise_prefs as written before personal tiers were per goal (UUID string ids). */
  interface PrefDoc {
    _id: string;
    userId: string;
    exerciseId: string;
    isFavorite: boolean;
    personalTier?: string | null;
    personalTiers?: { hypertrophy: string | null; powerlifting: string | null };
    createdAt: Date;
    updatedAt: Date;
    serverUpdatedAt: Date;
    deletedAt: Date | null;
  }

  const collection = () => db.collection<PrefDoc>('user_exercise_prefs');
  const legacy = (personalTier: string | null): PrefDoc => ({
    _id: randomUUID(),
    userId: randomUUID(),
    exerciseId: randomUUID(),
    isFavorite: false,
    personalTier,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    serverUpdatedAt: new Date('2026-01-01'),
    deletedAt: null,
  });

  it('turns the single personal tier into the same tier for both goals', async () => {
    const ranked = legacy('A');
    const unranked = legacy(null);
    await collection().insertMany([ranked, unranked]);

    expect(await prefs.migratePersonalTiers()).toBe(2);

    const after = await collection().findOne({ _id: ranked._id });
    expect(after).toMatchObject({ personalTiers: { hypertrophy: 'A', powerlifting: 'A' } });
    expect(after).not.toHaveProperty('personalTier');
    // Bumped so devices pull the new shape.
    expect(after!['serverUpdatedAt'].getTime()).toBeGreaterThan(Date.parse('2026-01-02'));

    expect(await collection().findOne({ _id: unranked._id })).toMatchObject({
      personalTiers: { hypertrophy: null, powerlifting: null },
    });
  });

  it('is idempotent and never overwrites per-goal tiers already set', async () => {
    const mixed = { ...legacy('C'), personalTiers: { hypertrophy: 'S', powerlifting: null } };
    await collection().insertOne(mixed);

    expect(await prefs.migratePersonalTiers()).toBe(1);
    expect(await prefs.migratePersonalTiers()).toBe(0);
    expect(await collection().findOne({ _id: mixed._id })).toMatchObject({
      personalTiers: { hypertrophy: 'S', powerlifting: 'C' },
    });
  });

  it('migrated documents read back through the API shape', async () => {
    const doc = legacy('B');
    await collection().insertOne(doc);
    await prefs.migratePersonalTiers();

    const view = await prefs.mapFor(doc.userId, [doc.exerciseId]);
    expect(view.get(doc.exerciseId)).toEqual({
      isFavorite: false,
      personalTiers: { hypertrophy: 'B', powerlifting: 'B' },
    });
  });
});
