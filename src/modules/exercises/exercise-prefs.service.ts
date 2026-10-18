import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { notDeleted } from '../../database/base.schema';
import { UpdateExercisePrefsDto } from './dto/exercise.dto';
import { TIER_GOALS, type Tiers } from './exercise.constants';
import { UserExercisePref } from './schemas/user-exercise-pref.schema';

export interface PrefView {
  isFavorite: boolean;
  personalTiers: Tiers;
}

export const NO_PERSONAL_TIERS: Tiers = { hypertrophy: null, powerlifting: null };
export const NO_PREFS: PrefView = { isFavorite: false, personalTiers: NO_PERSONAL_TIERS };

/** Tolerates documents written before personal tiers were per goal (see migratePersonalTiers). */
export function personalTiersOf(row: { personalTiers?: Partial<Tiers> | null }): Tiers {
  return {
    hypertrophy: row.personalTiers?.hypertrophy ?? null,
    powerlifting: row.personalTiers?.powerlifting ?? null,
  };
}

/** `$set` paths for a partial per-goal patch: only the goals present change. */
export function personalTiersSet(
  patch: UpdateExercisePrefsDto['personalTiers'],
): Record<string, Tiers[keyof Tiers]> {
  const $set: Record<string, Tiers[keyof Tiers]> = {};
  for (const goal of TIER_GOALS) {
    const tier = patch?.[goal];
    if (tier !== undefined) $set[`personalTiers.${goal}`] = tier;
  }
  return $set;
}

@Injectable()
export class ExercisePrefsService {
  private readonly logger = new Logger(ExercisePrefsService.name);

  constructor(
    @InjectModel(UserExercisePref.name) private readonly prefs: Model<UserExercisePref>,
  ) {}

  /** Prefs for a page of exercises in one query, keyed by exerciseId. */
  async mapFor(userId: string, exerciseIds: string[]): Promise<Map<string, PrefView>> {
    if (!exerciseIds.length) return new Map();
    const rows = await this.prefs.find(
      notDeleted<UserExercisePref>({ userId, exerciseId: { $in: exerciseIds } }),
      { exerciseId: 1, isFavorite: 1, personalTiers: 1 },
    );
    return new Map(
      rows.map((row) => [
        row.exerciseId,
        { isFavorite: row.isFavorite, personalTiers: personalTiersOf(row) },
      ]),
    );
  }

  async favoriteIds(userId: string): Promise<string[]> {
    const rows = await this.prefs.find(notDeleted<UserExercisePref>({ userId, isFavorite: true }), {
      exerciseId: 1,
    });
    return rows.map((row) => row.exerciseId);
  }

  /** Partial upsert: only the sent fields (and goals) change. Caller must check visibility. */
  async update(userId: string, exerciseId: string, dto: UpdateExercisePrefsDto): Promise<PrefView> {
    const $set: Record<string, unknown> = personalTiersSet(dto.personalTiers);
    if (dto.isFavorite !== undefined) $set['isFavorite'] = dto.isFavorite;

    const pref = await this.prefs.findOneAndUpdate(
      { userId, exerciseId },
      { $set: { ...$set, deletedAt: null }, $setOnInsert: { _id: randomUUID() } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return { isFavorite: pref.isFavorite, personalTiers: personalTiersOf(pref) };
  }

  /**
   * One-off (`npm run db:migrate-personal-tiers`): the old single `personalTier` becomes the
   * same tier for both goals, so nobody loses what they set. Idempotent. Raw driver call: the
   * filter targets a field the schema no longer has, and pipelines bypass syncTrackingPlugin,
   * so `serverUpdatedAt` is bumped here (devices must pull the new shape).
   */
  async migratePersonalTiers(): Promise<number> {
    const result = await this.prefs.collection.updateMany({ personalTier: { $exists: true } }, [
      {
        $set: {
          personalTiers: {
            hypertrophy: { $ifNull: ['$personalTiers.hypertrophy', '$personalTier'] },
            powerlifting: { $ifNull: ['$personalTiers.powerlifting', '$personalTier'] },
          },
          serverUpdatedAt: '$$NOW',
        },
      },
      { $unset: 'personalTier' },
    ]);
    this.logger.log(`Migrated ${result.modifiedCount} exercise prefs to per-goal personal tiers`);
    return result.modifiedCount;
  }
}
