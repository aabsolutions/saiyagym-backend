import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { I18nService } from 'nestjs-i18n';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { UsageCountersRegistry } from '../entitlements/usage-counters.registry';
import { ExercisesService } from '../exercises/exercises.service';
import { SyncRegistry } from '../sync/sync.registry';
import {
  CreateRoutineDto,
  RoutineDetailDto,
  RoutineListQueryDto,
  RoutinePageDto,
  RoutineSummaryDto,
  SyncRoutineDto,
  UpdateRoutineDto,
} from './dto/routine.dto';
import { RoutineUsageRegistry } from './routine-usage.registry';
import { assertValidRoutine, normalizeExercises, usesProgression } from './routine.rules';
import { Routine, RoutineDocument, RoutineExercise } from './schemas/routine.schema';

type Filter = QueryFilter<Routine>;

export interface NewRoutine {
  name: string;
  notes: string;
  exercises: RoutineExercise[];
}

@Injectable()
export class RoutinesService implements OnModuleInit {
  constructor(
    @InjectModel(Routine.name) private readonly routines: Model<Routine>,
    private readonly exercises: ExercisesService,
    private readonly entitlements: EntitlementsService,
    private readonly counters: UsageCountersRegistry,
    private readonly usage: RoutineUsageRegistry,
    private readonly i18n: I18nService,
    private readonly sync: SyncRegistry,
  ) {}

  onModuleInit(): void {
    // Plan limit `routines` counts live, non-archived routines (archiving frees a slot).
    this.counters.register('routines', (userId) =>
      this.routines.countDocuments(notDeleted<Routine>({ userId, archivedAt: null })),
    );

    this.sync.register({
      collection: 'routines',
      model: this.routines,
      push: {
        dto: SyncRoutineDto,
        prepare: (ctx, payload, existing) =>
          this.prepareSynced(ctx.userId, payload as SyncRoutineDto, existing as Routine | null),
        beforeDelete: async (ctx, existing) => {
          if (await this.usage.isInUse(ctx.userId, existing._id)) {
            throw new AppException(ErrorCode.ROUTINE_IN_USE, HttpStatus.CONFLICT);
          }
        },
      },
    });
  }

  /** Same rules as REST; the plan limit applies only when the routine starts counting. */
  private async prepareSynced(userId: string, dto: SyncRoutineDto, existing: Routine | null) {
    const exercises = normalizeExercises(dto.exercises);
    assertValidRoutine(exercises);
    // Exercises already in the stored routine stay valid even if deleted since.
    const known = new Set(existing?.exercises.map((e) => e.exerciseId) ?? []);
    await this.exercises.assertAccessible(
      userId,
      exercises.map((e) => e.exerciseId).filter((id) => !known.has(id)),
    );
    // Premium is needed to ADD or CHANGE rules; rules already stored (e.g. from before a downgrade)
    // can ride along on unrelated edits. Compared per slot id, so reordering isn't a change.
    const storedRules = new Map(
      existing?.exercises.map((e) => [e.id, JSON.stringify(e.progression)]) ?? [],
    );
    const changesRules = exercises.some(
      (e) => e.progression && storedRules.get(e.id) !== JSON.stringify(e.progression),
    );
    if (changesRules) await this.entitlements.assertFeature(userId, 'autoProgression');

    const archivedAt = dto.archivedAt ?? null;
    const counted = Boolean(existing && !existing.deletedAt && !existing.archivedAt);
    if (!archivedAt && !counted) await this.entitlements.assertWithinLimit(userId, 'routines');

    return { name: dto.name, notes: dto.notes ?? '', exercises, archivedAt };
  }

  // ----- queries -----

  async list(userId: string, query: RoutineListQueryDto): Promise<RoutinePageDto> {
    const filter: Filter = notDeleted<Routine>({ userId });
    if (query.archived === 'false') filter.archivedAt = null;
    if (query.archived === 'true') filter.archivedAt = { $ne: null };

    const [items, total] = await Promise.all([
      this.routines
        .find(filter)
        .sort({ updatedAt: -1, _id: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<Routine[]>(),
      this.routines.countDocuments(filter),
    ]);
    return { items: items.map(toSummary), meta: { page: query.page, limit: query.limit, total } };
  }

  async detail(userId: string, id: string, lang: string): Promise<RoutineDetailDto> {
    return this.toDetail(await this.requireOwned(userId, id), userId, lang);
  }

  /** Owned, non-deleted routines (archived included) keyed by id — for programs. */
  async findOwned(userId: string, ids: string[]): Promise<Map<string, Routine>> {
    if (!ids.length) return new Map();
    const docs = await this.routines
      .find(notDeleted<Routine>({ userId, _id: { $in: [...new Set(ids)] } }))
      .lean<Routine[]>();
    return new Map(docs.map((r) => [r._id, r]));
  }

  // ----- mutations -----

  async create(userId: string, dto: CreateRoutineDto, lang: string): Promise<RoutineDetailDto> {
    const exercises = normalizeExercises(dto.exercises);
    await this.validate(userId, exercises);
    const created = await this.routines.create({
      userId,
      name: dto.name,
      notes: dto.notes ?? '',
      exercises,
    });
    return this.toDetail(created.toObject(), userId, lang);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRoutineDto,
    lang: string,
  ): Promise<RoutineDetailDto> {
    const routine = await this.requireOwnedDoc(userId, id);
    if (dto.exercises) {
      const exercises = normalizeExercises(dto.exercises);
      await this.validate(userId, exercises);
      routine.exercises = exercises;
    }
    if (dto.name !== undefined) routine.name = dto.name;
    if (dto.notes !== undefined) routine.notes = dto.notes;
    await routine.save();
    return this.toDetail(routine.toObject(), userId, lang);
  }

  async reorder(
    userId: string,
    id: string,
    itemIds: string[],
    lang: string,
  ): Promise<RoutineDetailDto> {
    const routine = await this.requireOwnedDoc(userId, id);
    const bySlot = new Map(routine.exercises.map((e) => [e.id, e]));
    if (itemIds.length !== bySlot.size || itemIds.some((slotId) => !bySlot.has(slotId))) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
        details: [{ field: 'itemIds', constraints: ['permutationOfRoutineSlots'] }],
      });
    }
    const reordered = itemIds.map((slotId) => bySlot.get(slotId)!);
    assertValidRoutine(reordered); // a reorder may split a superset
    routine.exercises = reordered;
    await routine.save();
    return this.toDetail(routine.toObject(), userId, lang);
  }

  /** Copy with fresh slot ids. Counts toward the plan limit (guarded by @CheckLimit). */
  async duplicate(userId: string, id: string, lang: string): Promise<RoutineDetailDto> {
    const source = await this.requireOwned(userId, id);
    const suffix = String(this.i18n.t('common.copySuffix', { lang }));
    const created = await this.routines.create({
      userId,
      name: `${source.name} ${suffix}`.slice(0, 80),
      notes: source.notes,
      exercises: source.exercises.map((e) => ({ ...e, id: randomUUID() })),
    });
    return this.toDetail(created.toObject(), userId, lang);
  }

  async archive(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.routines.updateOne(
      { _id: id, userId, archivedAt: null },
      { archivedAt: new Date() },
    );
  }

  /** Back into the active set → counts toward the limit again. */
  async unarchive(userId: string, id: string): Promise<void> {
    const routine = await this.requireOwned(userId, id);
    if (!routine.archivedAt) return;
    await this.entitlements.assertWithinLimit(userId, 'routines');
    await this.routines.updateOne({ _id: id, userId }, { archivedAt: null });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    if (await this.usage.isInUse(userId, id)) {
      throw new AppException(ErrorCode.ROUTINE_IN_USE, HttpStatus.CONFLICT);
    }
    await this.routines.updateOne({ _id: id, userId }, { deletedAt: new Date() });
  }

  /**
   * Bulk creation for template copies. The caller has already checked the plan limit for the
   * whole batch and stripped Premium-only rules when needed.
   */
  async createMany(userId: string, routines: NewRoutine[]): Promise<Routine[]> {
    for (const routine of routines) assertValidRoutine(routine.exercises);
    const docs = await this.routines.insertMany(routines.map((r) => ({ ...r, userId })));
    return docs.map((doc) => doc.toObject() as Routine);
  }

  // ----- internals -----

  private async validate(userId: string, exercises: RoutineExercise[]): Promise<void> {
    assertValidRoutine(exercises);
    await this.exercises.assertAccessible(
      userId,
      exercises.map((e) => e.exerciseId),
    );
    if (usesProgression(exercises))
      await this.entitlements.assertFeature(userId, 'autoProgression');
  }

  private async requireOwned(userId: string, id: string): Promise<Routine> {
    const routine = await this.routines
      .findOne(notDeleted<Routine>({ _id: id, userId }))
      .lean<Routine>();
    if (!routine) throw notFound();
    return routine;
  }

  private async requireOwnedDoc(userId: string, id: string): Promise<RoutineDocument> {
    const routine = await this.routines.findOne(notDeleted<Routine>({ _id: id, userId }));
    if (!routine) throw notFound();
    return routine;
  }

  private async toDetail(
    routine: Routine,
    userId: string,
    lang: string,
  ): Promise<RoutineDetailDto> {
    const exercises = await this.exercises.findAccessible(
      userId,
      routine.exercises.map((e) => e.exerciseId),
    );
    return {
      id: routine._id,
      name: routine.name,
      notes: routine.notes,
      archived: routine.archivedAt !== null,
      exercises: routine.exercises.map((slot) => {
        const exercise = exercises.get(slot.exerciseId);
        return {
          id: slot.id,
          exerciseId: slot.exerciseId,
          exercise: exercise
            ? {
                name: localize(exercise.name, lang),
                primaryMuscle: exercise.primaryMuscle,
                equipment: exercise.equipment,
                mechanic: exercise.mechanic,
                imageUrl: exercise.imageUrl,
              }
            : null,
          groupId: slot.groupId,
          notes: slot.notes,
          sets: slot.sets,
          progression: slot.progression,
        };
      }),
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
    };
  }
}

function toSummary(routine: Routine): RoutineSummaryDto {
  return {
    id: routine._id,
    name: routine.name,
    notes: routine.notes,
    exerciseCount: routine.exercises.length,
    setCount: routine.exercises.reduce((total, e) => total + e.sets.length, 0),
    archived: routine.archivedAt !== null,
    updatedAt: routine.updatedAt,
  };
}

function notFound(): AppException {
  return new AppException(ErrorCode.ROUTINE_NOT_FOUND, HttpStatus.NOT_FOUND);
}
