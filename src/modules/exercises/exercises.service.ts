import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter, type SortOrder } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageMetaDto, skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { escapeRegex } from '../../common/utils/regex.util';
import { localize, type Translatable } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { UsageCountersRegistry } from '../entitlements/usage-counters.registry';
import { MediaService, type ImageScope } from '../media/media.service';
import { SyncRegistry } from '../sync/sync.registry';
import type { StoredSyncDoc } from '../sync/sync.types';
import { ExerciseQueryDto, TierListQueryDto } from './dto/exercise-query.dto';
import {
  AdminExerciseDto,
  BulkTiersDto,
  BulkTiersResultDto,
  CreateCustomExerciseDto,
  CreateGlobalExerciseDto,
  ExerciseDetailDto,
  ExercisePrefsDto,
  ExerciseSummaryDto,
  TierListDto,
  UpdateCustomExerciseDto,
  UpdateExercisePrefsDto,
  SyncExercisePrefDto,
  UpdateGlobalExerciseDto,
} from './dto/exercise.dto';
import {
  ExercisePrefsService,
  NO_PERSONAL_TIERS,
  NO_PREFS,
  personalTiersOf,
  type PrefView,
} from './exercise-prefs.service';
import { ExerciseGuidesService } from './exercise-guides.service';
import { ExerciseTagsService } from './exercise-tags.service';
import type { Tiers } from './exercise.constants';
import { Exercise, ExerciseDocument } from './schemas/exercise.schema';
import { UserExercisePref } from './schemas/user-exercise-pref.schema';
import { groupByTier } from './tier-list';

/** Content languages with a `name.<lang>` that is text-indexed and sortable. */
const INDEXED_LANGS = ['es', 'en'] as const;
const TIER_LIST_CAP = 2_000;

type Filter = QueryFilter<Exercise>;

@Injectable()
export class ExercisesService implements OnModuleInit {
  constructor(
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
    private readonly prefs: ExercisePrefsService,
    private readonly tags: ExerciseTagsService,
    private readonly media: MediaService,
    private readonly counters: UsageCountersRegistry,
    @InjectModel(UserExercisePref.name) private readonly prefModel: Model<UserExercisePref>,
    private readonly sync: SyncRegistry,
    private readonly guides: ExerciseGuidesService,
  ) {}

  onModuleInit(): void {
    // Plan limit `customExercises` counts the user's live custom exercises.
    this.counters.register('customExercises', (userId) =>
      this.exercises.countDocuments(customOf(userId)),
    );

    // Custom exercises: pull-only (the app needs them offline; they're created via REST).
    this.sync.register({
      collection: 'exercises',
      model: this.exercises,
      ownerField: 'ownerId',
      pullFilter: { isGlobal: false },
    });

    // Favorites / personal tier. Keyed by (user, exercise), NOT by _id: two devices may create
    // "the same" pref offline with different ids — they must converge on one document.
    this.sync.register({
      collection: 'user_exercise_prefs',
      model: this.prefModel,
      push: {
        dto: SyncExercisePrefDto,
        findExisting: async (ctx, id, payload) =>
          (await this.prefModel.findById(id).lean<StoredSyncDoc>()) ??
          ((payload as { exerciseId?: string }).exerciseId
            ? this.prefModel
                .findOne({
                  userId: ctx.userId,
                  exerciseId: (payload as SyncExercisePrefDto).exerciseId,
                })
                .lean<StoredSyncDoc>()
            : null),
        prepare: async (ctx, payload, existing) => {
          const dto = payload as SyncExercisePrefDto;
          if (existing && existing.exerciseId !== dto.exerciseId) {
            throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
              details: [{ field: 'doc.exerciseId', constraints: ['immutable'] }],
            });
          }
          if (!existing) await this.assertAccessible(ctx.userId, [dto.exerciseId]);
          // Full state per sync doc, but personal tiers merge per goal: a device that only
          // knows one goal's tier never wipes the other.
          const stored = existing
            ? personalTiersOf(existing as { personalTiers?: Partial<Tiers> | null })
            : NO_PERSONAL_TIERS;
          return {
            exerciseId: dto.exerciseId,
            isFavorite: dto.isFavorite ?? existing?.isFavorite ?? false,
            personalTiers: {
              hypertrophy:
                dto.personalTiers?.hypertrophy !== undefined
                  ? dto.personalTiers.hypertrophy
                  : stored.hypertrophy,
              powerlifting:
                dto.personalTiers?.powerlifting !== undefined
                  ? dto.personalTiers.powerlifting
                  : stored.powerlifting,
            },
          };
        },
      },
    });
  }

  // ===== User: catalog =====

  async list(userId: string, query: ExerciseQueryDto, lang: string) {
    const filter: Filter = {
      ...(query.custom ? customOf(userId) : visibleTo(userId)),
      ...attributeFilter(query),
    };
    if (query.favorites) filter._id = { $in: await this.prefs.favoriteIds(userId) };

    const { items, meta } = await this.search(filter, query, lang);
    const prefs = await this.prefs.mapFor(
      userId,
      items.map((e) => e._id),
    );
    return {
      items: items.map((e) => this.toSummary(e, lang, userId, prefs.get(e._id))),
      meta,
    };
  }

  async tierList(userId: string, query: TierListQueryDto, lang: string): Promise<TierListDto> {
    const filter: Filter = { ...visibleTo(userId) };
    if (query.muscle) filter.primaryMuscle = query.muscle;
    if (query.equipment) filter.equipment = query.equipment;

    const docs = await this.exercises.find(filter).limit(TIER_LIST_CAP).lean<Exercise[]>();
    const prefs = await this.prefs.mapFor(
      userId,
      docs.map((e) => e._id),
    );
    const summaries = docs.map((e) => this.toSummary(e, lang, userId, prefs.get(e._id)));
    const { tiers, unranked } = groupByTier(summaries, query.goal, query.source, lang);

    return {
      goal: query.goal,
      muscle: query.muscle ?? null,
      source: query.source,
      tiers,
      unranked,
    };
  }

  async detail(userId: string, id: string, lang: string): Promise<ExerciseDetailDto> {
    const exercise = await this.requireVisible(userId, id);
    const prefs = await this.prefs.mapFor(userId, [id]);
    return {
      ...this.toSummary(exercise, lang, userId, prefs.get(id)),
      description: localize(exercise.description, lang),
      instructions: localize(exercise.instructions, lang),
    };
  }

  async updatePrefs(
    userId: string,
    id: string,
    dto: UpdateExercisePrefsDto,
  ): Promise<ExercisePrefsDto> {
    await this.requireVisible(userId, id);
    return { exerciseId: id, ...(await this.prefs.update(userId, id, dto)) };
  }

  // ===== User: custom exercises =====

  async createCustom(
    userId: string,
    dto: CreateCustomExerciseDto,
    lang: string,
  ): Promise<ExerciseDetailDto> {
    await this.tags.assertExist(dto.tags);
    if (dto.imageUrl) this.media.assertValidImageUrl(dto.imageUrl, userScope(userId));

    const created = await this.exercises.create({
      slug: null,
      name: untranslated(dto.name),
      description: dto.description ? untranslated(dto.description) : {},
      instructions: dto.instructions ? untranslated(dto.instructions) : {},
      primaryMuscle: dto.primaryMuscle,
      secondaryMuscles: dto.secondaryMuscles ?? [],
      equipment: dto.equipment,
      mechanic: dto.mechanic,
      category: dto.category ?? 'accessory',
      imageUrl: dto.imageUrl ?? null,
      tags: dto.tags ?? [],
      tiers: { hypertrophy: null, powerlifting: null },
      isGlobal: false,
      ownerId: userId,
    });
    return this.detail(userId, created._id, lang);
  }

  async updateCustom(
    userId: string,
    id: string,
    dto: UpdateCustomExerciseDto,
    lang: string,
  ): Promise<ExerciseDetailDto> {
    const exercise = await this.exercises.findOne({ ...customOf(userId), _id: id });
    if (!exercise) throw notFound();
    await this.tags.assertExist(dto.tags);
    if (dto.imageUrl) this.media.assertValidImageUrl(dto.imageUrl, userScope(userId));

    const { name, description, instructions, ...rest } = dto;
    exercise.set(stripUndefined(rest));
    if (name !== undefined) exercise.name = untranslated(name);
    if (description !== undefined)
      exercise.description = description ? untranslated(description) : {};
    if (instructions !== undefined)
      exercise.instructions = instructions ? untranslated(instructions) : {};
    await exercise.save();
    return this.detail(userId, id, lang);
  }

  async removeCustom(userId: string, id: string): Promise<void> {
    const result = await this.exercises.updateOne(
      { ...customOf(userId), _id: id },
      { deletedAt: new Date() },
    );
    if (!result.matchedCount) throw notFound();
  }

  // ===== Admin: global catalog =====

  async listGlobal(query: ExerciseQueryDto) {
    const filter: Filter = { ...globalLive(), ...attributeFilter(query) };
    const { items, meta } = await this.search(filter, query, 'es');
    return { items: items.map((e) => this.toAdmin(e)), meta };
  }

  async findGlobal(id: string): Promise<AdminExerciseDto> {
    const exercise = await this.exercises.findOne({ ...globalLive(), _id: id }).lean<Exercise>();
    if (!exercise) throw notFound();
    return this.toAdmin(exercise);
  }

  async createGlobal(dto: CreateGlobalExerciseDto): Promise<AdminExerciseDto> {
    // Slugs of soft-deleted exercises stay reserved (otherwise the seed would resurrect them).
    if (await this.exercises.exists({ slug: dto.slug })) throw slugTaken();
    await this.tags.assertExist(dto.tags);
    if (dto.imageUrl) this.media.assertValidImageUrl(dto.imageUrl, GLOBAL_SCOPE);

    try {
      const created = await this.exercises.create({
        ...dto,
        description: dto.description ?? {},
        instructions: dto.instructions ?? {},
        secondaryMuscles: dto.secondaryMuscles ?? [],
        category: dto.category ?? 'strength',
        tags: dto.tags ?? [],
        imageUrl: dto.imageUrl ?? null,
        isGlobal: true,
        ownerId: null,
      });
      return this.toAdmin(created);
    } catch (error) {
      if ((error as { code?: unknown }).code === 11000) throw slugTaken();
      throw error;
    }
  }

  async updateGlobal(id: string, dto: UpdateGlobalExerciseDto): Promise<AdminExerciseDto> {
    const exercise = await this.exercises.findOne({ ...globalLive(), _id: id });
    if (!exercise) throw notFound();
    await this.tags.assertExist(dto.tags);
    if (dto.imageUrl) this.media.assertValidImageUrl(dto.imageUrl, GLOBAL_SCOPE);

    exercise.set(stripUndefined({ ...dto }));
    await exercise.save();
    return this.toAdmin(exercise);
  }

  async removeGlobal(id: string): Promise<void> {
    const result = await this.exercises.updateOne(
      { ...globalLive(), _id: id },
      { deletedAt: new Date() },
    );
    if (!result.matchedCount) throw notFound();
  }

  async bulkUpdateTiers(dto: BulkTiersDto): Promise<BulkTiersResultDto> {
    const ids = dto.items.map((item) => item.id);
    const existing = new Set(
      (
        await this.exercises
          .find({ ...globalLive(), _id: { $in: ids } }, { _id: 1 })
          .lean<{ _id: string }[]>()
      ).map((e) => e._id),
    );

    const operations = dto.items
      .filter((item) => existing.has(item.id))
      .map((item) => {
        const $set: Record<string, unknown> = {};
        if (item.hypertrophy !== undefined) $set['tiers.hypertrophy'] = item.hypertrophy;
        if (item.powerlifting !== undefined) $set['tiers.powerlifting'] = item.powerlifting;
        return { updateOne: { filter: { _id: item.id }, update: { $set } } };
      })
      .filter((op) => Object.keys(op.updateOne.update.$set).length > 0);

    if (operations.length) await this.exercises.bulkWrite(operations, { ordered: false });
    return { updated: operations.length, notFound: ids.filter((id) => !existing.has(id)) };
  }

  // ===== For other modules (routines, programs) =====

  /** Exercises the user may use (global + own custom, not deleted), keyed by id. */
  async findAccessible(userId: string, ids: string[]): Promise<Map<string, Exercise>> {
    if (!ids.length) return new Map();
    const docs = await this.exercises
      .find({ ...visibleTo(userId), _id: { $in: [...new Set(ids)] } })
      .lean<Exercise[]>();
    return new Map(docs.map((e) => [e._id, e]));
  }

  /** 400 EXERCISE_NOT_FOUND listing ids that don't exist or belong to someone else. */
  async assertAccessible(userId: string, ids: string[]): Promise<Map<string, Exercise>> {
    const found = await this.findAccessible(userId, ids);
    const missing = [...new Set(ids)].filter((id) => !found.has(id));
    if (missing.length) {
      throw new AppException(ErrorCode.EXERCISE_NOT_FOUND, HttpStatus.BAD_REQUEST, {
        details: { missing },
      });
    }
    return found;
  }

  /** Live global exercises by slug (templates reference slugs: ids differ per environment). */
  async findGlobalBySlugs(slugs: string[]): Promise<Map<string, Exercise>> {
    if (!slugs.length) return new Map();
    const docs = await this.exercises
      .find({ ...globalLive(), slug: { $in: [...new Set(slugs)] } })
      .lean<Exercise[]>();
    return new Map(docs.map((e) => [e.slug!, e]));
  }

  // ===== Internals =====

  private async requireVisible(userId: string, id: string): Promise<Exercise> {
    const exercise = await this.exercises
      .findOne({ ...visibleTo(userId), _id: id })
      .lean<Exercise>();
    if (!exercise) throw notFound();
    return exercise;
  }

  /**
   * `q` first uses the text index (whole words, accent-insensitive, every word required).
   * If that finds nothing — typically a partial word while typing ("sent" → "sentadilla") —
   * it falls back to a case-insensitive substring match on the names.
   */
  private async search(
    filter: Filter,
    query: ExerciseQueryDto,
    lang: string,
  ): Promise<{ items: Exercise[]; meta: PageMetaDto }> {
    if (!query.q) return this.findPage(filter, query, lang, false);

    const phrase = query.q.replace(/["\\-]/g, ' ').trim();
    const allWords = phrase
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => `"${word}"`)
      .join(' ');
    if (allWords) {
      const page = await this.findPage(
        { ...filter, $text: { $search: allWords } },
        query,
        lang,
        true,
      );
      if (page.meta.total > 0) return page;
    }

    const pattern = { $regex: escapeRegex(query.q), $options: 'i' };
    const substring: Filter = {
      ...filter,
      $and: [{ $or: INDEXED_LANGS.map((l) => ({ [`name.${l}`]: pattern })) }],
    };
    return this.findPage(substring, query, lang, false);
  }

  private async findPage(filter: Filter, query: ExerciseQueryDto, lang: string, isText: boolean) {
    const sortLang = contentLang(lang);
    const nameKey = `name.${sortLang}`;
    let sort: Record<string, SortOrder | { $meta: 'textScore' }>;
    switch (query.sort) {
      case 'relevance':
        sort = isText ? { score: { $meta: 'textScore' }, [nameKey]: 1 } : { [nameKey]: 1 };
        break;
      case '-name':
        sort = { [nameKey]: -1 };
        break;
      case 'createdAt':
        sort = { createdAt: 1 };
        break;
      case '-createdAt':
        sort = { createdAt: -1 };
        break;
      default:
        sort = { [nameKey]: 1 };
    }
    sort._id = 1; // stable pagination

    let cursor = this.exercises.find(filter).sort(sort).skip(skipFor(query)).limit(query.limit);
    // Locale-aware, accent/case-insensitive name ordering. MongoDB forbids collation with $text.
    if (!isText) cursor = cursor.collation({ locale: sortLang, strength: 1 });

    const [items, total] = await Promise.all([
      cursor.lean<Exercise[]>(),
      this.exercises.countDocuments(filter),
    ]);
    return { items, meta: { page: query.page, limit: query.limit, total } };
  }

  private toSummary(
    e: Exercise,
    lang: string,
    userId: string,
    pref: PrefView = NO_PREFS,
  ): ExerciseSummaryDto {
    return {
      id: e._id,
      slug: e.slug,
      name: localize(e.name, lang),
      primaryMuscle: e.primaryMuscle,
      secondaryMuscles: e.secondaryMuscles,
      equipment: e.equipment,
      mechanic: e.mechanic,
      category: e.category,
      trackingType: e.trackingType,
      imageUrl: e.imageUrl,
      tags: e.tags,
      tiers: { hypertrophy: e.tiers.hypertrophy, powerlifting: e.tiers.powerlifting },
      isGlobal: e.isGlobal,
      isCustom: !e.isGlobal && e.ownerId === userId,
      isFavorite: pref.isFavorite,
      personalTiers: pref.personalTiers,
      // Legacy documents (before guides existed) have no `guides` field.
      hasGuide: (e.guides?.length ?? 0) > 0,
    };
  }

  private toAdmin(e: Exercise | ExerciseDocument): AdminExerciseDto {
    return {
      id: e._id,
      slug: e.slug,
      name: e.name,
      description: e.description,
      instructions: e.instructions,
      primaryMuscle: e.primaryMuscle,
      secondaryMuscles: e.secondaryMuscles,
      equipment: e.equipment,
      mechanic: e.mechanic,
      category: e.category,
      trackingType: e.trackingType,
      imageUrl: e.imageUrl,
      tags: e.tags,
      tiers: { hypertrophy: e.tiers.hypertrophy, powerlifting: e.tiers.powerlifting },
      guides: (e.guides ?? []).map((g) => this.guides.toAdmin(g)),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}

// ----- filters -----

const GLOBAL_SCOPE: ImageScope = { kind: 'global' };
const userScope = (userId: string): ImageScope => ({ kind: 'user', userId });

/** Global catalog + the user's own custom exercises. Other users' customs are invisible. */
function visibleTo(userId: string): Filter {
  return notDeleted<Exercise>({ $or: [{ isGlobal: true }, { ownerId: userId, isGlobal: false }] });
}

function customOf(userId: string): Filter {
  return notDeleted<Exercise>({ isGlobal: false, ownerId: userId });
}

function globalLive(): Filter {
  return notDeleted<Exercise>({ isGlobal: true });
}

function attributeFilter(query: ExerciseQueryDto): Filter {
  const filter: Filter = {};
  if (query.muscle) filter.primaryMuscle = query.muscle;
  if (query.equipment) filter.equipment = query.equipment;
  if (query.mechanic) filter.mechanic = query.mechanic;
  if (query.category) filter.category = query.category;
  if (query.tag) filter.tags = query.tag;
  if (query.goal && query.tier) filter[`tiers.${query.goal}`] = query.tier;
  return filter;
}

// ----- helpers -----

/** `es`/`en` (incl. regional variants) map to themselves; anything else sorts by `es`. */
function contentLang(lang: string): (typeof INDEXED_LANGS)[number] {
  const base = lang.split('-')[0];
  return INDEXED_LANGS.find((l) => l === base) ?? 'es';
}

/**
 * User-written text isn't translated. It's stored under every indexed language so text search
 * and name sorting treat it like catalog content in any UI language.
 */
function untranslated(text: string): Translatable {
  return Object.fromEntries(INDEXED_LANGS.map((l) => [l, text]));
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function notFound(): AppException {
  return new AppException(ErrorCode.EXERCISE_NOT_FOUND, HttpStatus.NOT_FOUND);
}

function slugTaken(): AppException {
  return new AppException(ErrorCode.EXERCISE_SLUG_TAKEN, HttpStatus.CONFLICT);
}
