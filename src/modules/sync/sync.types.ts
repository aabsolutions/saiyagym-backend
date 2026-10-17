import type { Type } from '@nestjs/common';
import type { Model } from 'mongoose';

/** Writable from clients via POST /sync/push. */
export const PUSH_COLLECTIONS = [
  'workouts',
  'routines',
  'body_metrics',
  'user_exercise_prefs',
] as const;
/** Everything GET /sync/pull returns (push collections + read-only ones the app needs offline). */
export const PULL_COLLECTIONS = [...PUSH_COLLECTIONS, 'programs', 'exercises'] as const;

export type PushCollection = (typeof PUSH_COLLECTIONS)[number];
export type SyncCollection = (typeof PULL_COLLECTIONS)[number];

export const SYNC_OPS = ['upsert', 'delete'] as const;
export type SyncOp = (typeof SYNC_OPS)[number];

export interface SyncContext {
  userId: string;
  lang: string;
  now: Date;
}

/** Minimal shape every synced document has (see BaseSchema + syncTrackingPlugin). */
export interface StoredSyncDoc {
  _id: string;
  updatedAt: Date;
  createdAt: Date;
  deletedAt: Date | null;
  [key: string]: unknown;
}

/**
 * Per-collection plug-in. The sync module owns the PROTOCOL (envelope validation, last-write-wins,
 * optimistic concurrency, results); each domain module owns its RULES (validation, ownership of
 * references, plan limits, Premium features, derived fields, events) and registers a handler.
 */
export interface SyncHandler {
  collection: SyncCollection;
  model: Model<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- heterogeneous registry
  /** Owner field name (`ownerId` for custom exercises). */
  ownerField?: 'userId' | 'ownerId';
  /** Extra pull filter, e.g. only custom exercises. */
  pullFilter?: Record<string, unknown>;
  /** Absent = pull-only. */
  push?: {
    /** Validates the doc payload (envelope fields id/updatedAt/createdAt/deletedAt already removed). */
    dto: Type<object>;
    /** How to find the stored version of an incoming doc. Default: by `_id` (any owner). */
    findExisting?(ctx: SyncContext, id: string, payload: object): Promise<StoredSyncDoc | null>;
    /**
     * Domain checks + normalization. Returns the document body to store (no _id/owner/timestamps).
     * Throw an AppException to reject this single change.
     */
    prepare(
      ctx: SyncContext,
      payload: object,
      existing: StoredSyncDoc | null,
    ): Promise<Record<string, unknown>>;
    beforeDelete?(ctx: SyncContext, existing: StoredSyncDoc): Promise<void>;
    /** Awaited before the change is reported (e.g. PR recompute). */
    afterWrite?(
      ctx: SyncContext,
      before: StoredSyncDoc | null,
      after: StoredSyncDoc,
    ): void | Promise<void>;
  };
}
