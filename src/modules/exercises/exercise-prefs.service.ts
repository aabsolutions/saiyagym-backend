import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { notDeleted } from '../../database/base.schema';
import { UpdateExercisePrefsDto } from './dto/exercise.dto';
import type { Tier } from './exercise.constants';
import { UserExercisePref } from './schemas/user-exercise-pref.schema';

export interface PrefView {
  isFavorite: boolean;
  personalTier: Tier | null;
}

export const NO_PREFS: PrefView = { isFavorite: false, personalTier: null };

@Injectable()
export class ExercisePrefsService {
  constructor(
    @InjectModel(UserExercisePref.name) private readonly prefs: Model<UserExercisePref>,
  ) {}

  /** Prefs for a page of exercises in one query, keyed by exerciseId. */
  async mapFor(userId: string, exerciseIds: string[]): Promise<Map<string, PrefView>> {
    if (!exerciseIds.length) return new Map();
    const rows = await this.prefs.find(
      notDeleted<UserExercisePref>({ userId, exerciseId: { $in: exerciseIds } }),
      { exerciseId: 1, isFavorite: 1, personalTier: 1 },
    );
    return new Map(
      rows.map((row) => [
        row.exerciseId,
        { isFavorite: row.isFavorite, personalTier: row.personalTier },
      ]),
    );
  }

  async favoriteIds(userId: string): Promise<string[]> {
    const rows = await this.prefs.find(notDeleted<UserExercisePref>({ userId, isFavorite: true }), {
      exerciseId: 1,
    });
    return rows.map((row) => row.exerciseId);
  }

  /** Partial upsert: only the sent fields change. Caller must check the exercise is visible. */
  async update(userId: string, exerciseId: string, dto: UpdateExercisePrefsDto): Promise<PrefView> {
    const $set: Partial<PrefView> = {};
    if (dto.isFavorite !== undefined) $set.isFavorite = dto.isFavorite;
    if (dto.personalTier !== undefined) $set.personalTier = dto.personalTier;

    const pref = await this.prefs.findOneAndUpdate(
      { userId, exerciseId },
      { $set: { ...$set, deletedAt: null }, $setOnInsert: { _id: randomUUID() } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return { isFavorite: pref.isFavorite, personalTier: pref.personalTier };
  }
}
