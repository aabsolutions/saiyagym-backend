import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { I18nService } from 'nestjs-i18n';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import { flattenValidationErrors } from '../../common/utils/validation-errors.util';
import { SyncChangeDto, SyncPullResultDto, SyncPushResultDto, SyncResultDto } from './dto/sync.dto';
import { SyncRegistry } from './sync.registry';
import type { StoredSyncDoc, SyncContext, SyncHandler } from './sync.types';
import { scrubText } from '../../common/utils/log-redaction.util';

/** A client clock this far ahead would win every conflict forever — reject instead. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/**
 * Pull returns changes up to `now - margin` and hands that back as the next cursor, so writes that
 * got their serverUpdatedAt just before the query but committed just after it are picked up next
 * time instead of being skipped. Duplicates are harmless (clients apply LWW too).
 */
export const PULL_SAFETY_MARGIN_MS = 2_000;
const MAX_ATTEMPTS = 2;

type Outcome = 'applied' | 'ignored_older';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly registry: SyncRegistry,
    private readonly i18n: I18nService,
  ) {}

  /**
   * One-off migration: documents created before syncTrackingPlugin existed get
   * serverUpdatedAt = updatedAt. NOT run at boot — `{ $exists: false }` has no index, so it would
   * scan every synced collection on each cold start. Run `npm run db:backfill-sync` when needed.
   */
  async backfillServerUpdatedAt(): Promise<void> {
    for (const handler of this.registry.all()) {
      const result = await handler.model.updateMany(
        { serverUpdatedAt: { $exists: false } },
        [{ $set: { serverUpdatedAt: { $ifNull: ['$updatedAt', '$$NOW'] } } }],
        // Mongoose 9 requires opting in to pipeline updates.
        { timestamps: false, updatePipeline: true },
      );
      if (result.modifiedCount) {
        this.logger.log(
          `Backfilled serverUpdatedAt on ${result.modifiedCount} ${handler.collection}`,
        );
      }
    }
  }

  // ===== push =====

  async push(userId: string, lang: string, changes: SyncChangeDto[]): Promise<SyncPushResultDto> {
    const ctx: SyncContext = { userId, lang, now: new Date() };
    const results: SyncResultDto[] = [];
    for (const [index, change] of changes.entries()) {
      results.push(await this.applyChange(ctx, index, change));
    }
    return { results, serverTime: new Date().toISOString() };
  }

  private async applyChange(
    ctx: SyncContext,
    index: number,
    change: SyncChangeDto,
  ): Promise<SyncResultDto> {
    const base = { index, collection: change.collection };
    const rawId = change.doc.id;
    try {
      const handler = this.registry.get(change.collection);
      const envelope = this.parseEnvelope(ctx, change.doc);
      const { id, status } =
        change.op === 'delete'
          ? await this.withRetry(() => this.applyDelete(ctx, handler, envelope))
          : await this.withRetry(() => this.applyUpsert(ctx, handler, envelope));
      return { ...base, id, status };
    } catch (error) {
      return {
        ...base,
        id: typeof rawId === 'string' ? rawId : null,
        status: 'error',
        error: this.toResultError(error, ctx.lang),
      };
    }
  }

  private async applyUpsert(ctx: SyncContext, handler: SyncHandler, envelope: Envelope) {
    const push = handler.push!;
    const payload = plainToInstance(push.dto, envelope.payload);
    const violations = flattenValidationErrors(
      await validate(payload, { whitelist: true, forbidNonWhitelisted: true }),
    );
    if (violations.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
        details: violations.map((v) => ({ ...v, field: `doc.${v.field}` })),
      });
    }

    const existing = await this.findExisting(ctx, handler, envelope.id, payload);
    const decision = this.lww(ctx, handler, existing, envelope.updatedAt);
    if (decision) return { id: existing!._id, status: decision };

    const body = await push.prepare(ctx, payload, existing);
    const doc: StoredSyncDoc = {
      ...body,
      _id: existing?._id ?? envelope.id,
      [owner(handler)]: ctx.userId,
      createdAt: existing?.createdAt ?? envelope.createdAt ?? envelope.updatedAt,
      updatedAt: envelope.updatedAt,
      deletedAt: null,
    };
    await this.write(handler, existing, doc);
    await push.afterWrite?.(ctx, existing, doc);
    return { id: doc._id, status: 'applied' as const };
  }

  private async applyDelete(ctx: SyncContext, handler: SyncHandler, envelope: Envelope) {
    const existing = await this.findExisting(ctx, handler, envelope.id, envelope.payload);
    // Created and deleted offline before ever reaching the server: nothing to delete.
    if (!existing) return { id: envelope.id, status: 'applied' as const };

    const decision = this.lww(ctx, handler, existing, envelope.updatedAt);
    if (decision) return { id: existing._id, status: decision };

    await handler.push!.beforeDelete?.(ctx, existing);
    const deletedAt = existing.deletedAt ?? envelope.deletedAt ?? envelope.updatedAt;
    const result = await handler.model.updateOne(
      { _id: existing._id, updatedAt: existing.updatedAt },
      { $set: { deletedAt, updatedAt: envelope.updatedAt } },
      { timestamps: false },
    );
    if (!result.matchedCount) throw new ConcurrentModification();
    await handler.push!.afterWrite?.(ctx, existing, {
      ...existing,
      deletedAt,
      updatedAt: envelope.updatedAt,
    });
    return { id: existing._id, status: 'applied' as const };
  }

  /**
   * Last write wins on the CLIENT's updatedAt.
   * - newer incoming → write (returns null)
   * - same timestamp → already have this version: idempotent replay, report `applied`, no write
   * - older incoming → `ignored_older`
   */
  private lww(
    ctx: SyncContext,
    handler: SyncHandler,
    existing: StoredSyncDoc | null,
    incoming: Date,
  ): Outcome | null {
    if (!existing) return null;
    if (existing[owner(handler)] !== ctx.userId) {
      // Someone else's id (collision or probing). Don't reveal anything about it.
      throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    const stored = existing.updatedAt.getTime();
    if (incoming.getTime() > stored) return null;
    return incoming.getTime() === stored ? 'applied' : 'ignored_older';
  }

  /** Optimistic concurrency: the write only lands if the doc is still the version we read. */
  private async write(
    handler: SyncHandler,
    existing: StoredSyncDoc | null,
    doc: StoredSyncDoc,
  ): Promise<void> {
    if (existing) {
      const result = await handler.model.replaceOne(
        { _id: existing._id, updatedAt: existing.updatedAt },
        doc,
        { timestamps: false },
      );
      if (!result.matchedCount) throw new ConcurrentModification();
      return;
    }
    try {
      await handler.model.create([doc], { timestamps: false });
    } catch (error) {
      if ((error as { code?: unknown }).code === 11000) throw new ConcurrentModification();
      throw error;
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof ConcurrentModification)) throw error;
        if (attempt >= MAX_ATTEMPTS) {
          throw new AppException(ErrorCode.CONFLICT, HttpStatus.CONFLICT, { cause: error });
        }
      }
    }
  }

  private async findExisting(ctx: SyncContext, handler: SyncHandler, id: string, payload: object) {
    if (handler.push?.findExisting) return handler.push.findExisting(ctx, id, payload);
    return handler.model.findById(id).lean<StoredSyncDoc>();
  }

  private parseEnvelope(ctx: SyncContext, doc: Record<string, unknown>): Envelope {
    const { id, updatedAt, createdAt, deletedAt, ...payload } = doc;
    const violations: { field: string; constraints: string[] }[] = [];
    if (typeof id !== 'string' || !isUUID(id, '4'))
      violations.push({ field: 'doc.id', constraints: ['isUuid'] });
    const parsedUpdatedAt = parseDate(updatedAt);
    if (!parsedUpdatedAt) violations.push({ field: 'doc.updatedAt', constraints: ['isIsoDate'] });
    const parsedCreatedAt = createdAt === undefined ? null : parseDate(createdAt);
    if (createdAt !== undefined && !parsedCreatedAt)
      violations.push({ field: 'doc.createdAt', constraints: ['isIsoDate'] });
    const parsedDeletedAt =
      deletedAt === undefined || deletedAt === null ? null : parseDate(deletedAt);
    if (deletedAt && !parsedDeletedAt)
      violations.push({ field: 'doc.deletedAt', constraints: ['isIsoDate'] });
    if (violations.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
        details: violations,
      });
    }
    if (parsedUpdatedAt!.getTime() > ctx.now.getTime() + MAX_CLOCK_SKEW_MS) {
      throw new AppException(ErrorCode.CLOCK_SKEW, HttpStatus.BAD_REQUEST, {
        details: { updatedAt: parsedUpdatedAt, serverTime: ctx.now },
      });
    }
    return {
      id: id as string,
      updatedAt: parsedUpdatedAt!,
      createdAt: parsedCreatedAt,
      deletedAt: parsedDeletedAt,
      payload,
    };
  }

  private toResultError(error: unknown, lang: string) {
    if (error instanceof AppException) {
      return {
        code: error.code,
        message: String(this.i18n.t(`errors.${error.code}`, { lang, args: error.args })),
        ...(error.details !== undefined && { details: error.details }),
      };
    }
    this.logger.error(
      'Sync change failed unexpectedly',
      scrubText(error instanceof Error ? (error.stack ?? error.message) : String(error)),
    );
    return {
      code: ErrorCode.INTERNAL_ERROR,
      message: String(this.i18n.t(`errors.${ErrorCode.INTERNAL_ERROR}`, { lang })),
    };
  }

  // ===== pull =====

  async pull(userId: string, since: Date | undefined): Promise<SyncPullResultDto> {
    const until = new Date(Date.now() - PULL_SAFETY_MARGIN_MS);
    const changes: SyncPullResultDto['changes'] = {};
    for (const handler of this.registry.all()) {
      const docs = await handler.model
        .find({
          [owner(handler)]: userId,
          ...handler.pullFilter,
          serverUpdatedAt: { $gte: since ?? new Date(0), $lt: until },
        })
        .sort({ serverUpdatedAt: 1 })
        .lean<StoredSyncDoc[]>();
      changes[handler.collection] = docs.map((doc) => toPullDoc(handler, doc));
    }
    return { serverTime: until.toISOString(), changes };
  }
}

interface Envelope {
  id: string;
  updatedAt: Date;
  createdAt: Date | null;
  deletedAt: Date | null;
  payload: Record<string, unknown>;
}

class ConcurrentModification extends Error {}

function owner(handler: SyncHandler): 'userId' | 'ownerId' {
  return handler.ownerField ?? 'userId';
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Wire format: `id` instead of `_id`, without owner and internal bookkeeping fields. */
function toPullDoc(handler: SyncHandler, doc: StoredSyncDoc): Record<string, unknown> {
  const hidden = new Set(['_id', 'serverUpdatedAt', owner(handler)]);
  return {
    id: doc._id,
    ...Object.fromEntries(Object.entries(doc).filter(([key]) => !hidden.has(key))),
  };
}
