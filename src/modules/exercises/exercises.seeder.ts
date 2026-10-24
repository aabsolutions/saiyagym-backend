import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Translatable } from '../../common/utils/translatable.util';
import { SLUG_PATTERN } from './dto/exercise-query.dto';
import {
  CATEGORIES,
  EQUIPMENT,
  MECHANICS,
  MUSCLES,
  TIERS,
  type Category,
  type Equipment,
  type Mechanic,
  type Muscle,
  type Tiers,
} from './exercise.constants';
import { Exercise } from './schemas/exercise.schema';
import { ExerciseTag } from './schemas/exercise-tag.schema';

export interface SeedTag {
  slug: string;
  name: Translatable;
}

export interface SeedExercise {
  slug: string;
  name: Translatable;
  description?: Translatable;
  /** Execution steps, one per line. */
  instructions?: Translatable;
  primaryMuscle: Muscle;
  secondaryMuscles: Muscle[];
  equipment: Equipment;
  mechanic: Mechanic;
  category: Category;
  tiers: Tiers;
  tags: string[];
}

export interface SeedFile {
  tags: SeedTag[];
  exercises: SeedExercise[];
}

export interface SeedReport {
  inserted: number;
  updated: number;
  skipped: number;
}

/** src/database/seeds/exercises.seed.json (copied to dist by nest-cli assets). */
export const SEED_FILE_PATH = join(
  __dirname,
  '..',
  '..',
  'database',
  'seeds',
  'exercises.seed.json',
);

export function loadSeedFile(path = SEED_FILE_PATH): SeedFile {
  return JSON.parse(readFileSync(path, 'utf8')) as SeedFile;
}

/** Structural checks so a typo in the JSON fails loudly instead of seeding garbage. */
export function validateSeedFile(data: SeedFile): string[] {
  const errors: string[] = [];
  const bilingual = (t: Translatable | undefined) => Boolean(t?.es?.trim() && t?.en?.trim());
  const tagSlugs = new Set<string>();

  for (const tag of data.tags) {
    if (!SLUG_PATTERN.test(tag.slug)) errors.push(`tag ${tag.slug}: invalid slug`);
    if (tagSlugs.has(tag.slug)) errors.push(`tag ${tag.slug}: duplicated`);
    if (!bilingual(tag.name)) errors.push(`tag ${tag.slug}: name needs es and en`);
    tagSlugs.add(tag.slug);
  }

  const slugs = new Set<string>();
  for (const e of data.exercises) {
    const at = `exercise ${e.slug}`;
    if (!SLUG_PATTERN.test(e.slug)) errors.push(`${at}: invalid slug`);
    if (slugs.has(e.slug)) errors.push(`${at}: duplicated slug`);
    slugs.add(e.slug);
    if (!bilingual(e.name)) errors.push(`${at}: name needs es and en`);
    if (e.description && !bilingual(e.description))
      errors.push(`${at}: description needs es and en`);
    if (e.instructions && !bilingual(e.instructions))
      errors.push(`${at}: instructions needs es and en`);
    if (!MUSCLES.includes(e.primaryMuscle))
      errors.push(`${at}: bad primaryMuscle ${e.primaryMuscle}`);
    for (const m of e.secondaryMuscles) {
      if (!MUSCLES.includes(m)) errors.push(`${at}: bad secondary muscle ${m}`);
      if (m === e.primaryMuscle) errors.push(`${at}: ${m} is both primary and secondary`);
    }
    if (!EQUIPMENT.includes(e.equipment)) errors.push(`${at}: bad equipment ${e.equipment}`);
    if (!MECHANICS.includes(e.mechanic)) errors.push(`${at}: bad mechanic ${e.mechanic}`);
    if (!CATEGORIES.includes(e.category)) errors.push(`${at}: bad category ${e.category}`);
    for (const goal of ['hypertrophy', 'powerlifting'] as const) {
      const tier = e.tiers?.[goal];
      if (tier !== null && !TIERS.includes(tier))
        errors.push(`${at}: bad ${goal} tier ${String(tier)}`);
    }
    for (const tag of e.tags) if (!tagSlugs.has(tag)) errors.push(`${at}: unknown tag ${tag}`);
  }
  return errors;
}

/**
 * Idempotent upsert by slug.
 * - Default: inserts what's missing, never touches existing docs (admin edits win) — except
 *   `instructions`, which are filled where still EMPTY (they were added to the seed later).
 * - `update: true`: overwrites existing, non-deleted docs with the JSON.
 * Soft-deleted items keep their slug, so they're found and skipped — never resurrected.
 */
@Injectable()
export class ExercisesSeeder {
  private readonly logger = new Logger(ExercisesSeeder.name);

  constructor(
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
    @InjectModel(ExerciseTag.name) private readonly tags: Model<ExerciseTag>,
  ) {}

  async run(
    data: SeedFile,
    options: { update: boolean },
  ): Promise<{ tags: SeedReport; exercises: SeedReport; instructionsFilled: number }> {
    const errors = validateSeedFile(data);
    if (errors.length) throw new Error(`Invalid seed file:\n- ${errors.join('\n- ')}`);

    const tags = await this.upsertAll(this.tags, data.tags, options.update, (tag) => tag);
    const exercises = await this.upsertAll(this.exercises, data.exercises, options.update, (e) => ({
      ...e,
      description: e.description ?? {},
      instructions: e.instructions ?? {},
      isGlobal: true,
      ownerId: null,
    }));
    const instructionsFilled = await this.fillEmptyInstructions(data.exercises);
    this.logger.log(
      `Tags ${JSON.stringify(tags)} · Exercises ${JSON.stringify(exercises)} · ` +
        `instructions filled: ${instructionsFilled}`,
    );
    return { tags, exercises, instructionsFilled };
  }

  /** Never overwrites instructions an admin wrote: only missing / `{}` ones. */
  private async fillEmptyInstructions(items: SeedExercise[]): Promise<number> {
    let filled = 0;
    for (const item of items) {
      if (!item.instructions) continue;
      const result = await this.exercises.updateOne(
        {
          slug: item.slug,
          deletedAt: null,
          $or: [{ instructions: { $exists: false } }, { instructions: {} }],
        },
        { $set: { instructions: item.instructions } },
      );
      filled += result.modifiedCount;
    }
    return filled;
  }

  private async upsertAll<
    T extends { slug: string },
    D extends { slug: string | null; deletedAt: Date | null },
  >(model: Model<D>, items: T[], update: boolean, toDoc: (item: T) => object): Promise<SeedReport> {
    const report: SeedReport = { inserted: 0, updated: 0, skipped: 0 };
    const existing = new Map(
      (
        await model
          .find({ slug: { $in: items.map((i) => i.slug) } }, { slug: 1, deletedAt: 1 })
          .lean<D[]>()
      ).map((doc) => [doc.slug, doc]),
    );

    for (const item of items) {
      const current = existing.get(item.slug);
      if (!current) {
        await model.create(toDoc(item));
        report.inserted++;
      } else if (update && !current.deletedAt) {
        await model.updateOne({ slug: item.slug }, { $set: toDoc(item) });
        report.updated++;
      } else {
        report.skipped++;
      }
    }
    return report;
  }
}
