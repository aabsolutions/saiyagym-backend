import { randomUUID } from 'node:crypto';
import { Prop } from '@nestjs/mongoose';
import type { QueryFilter } from 'mongoose';

/**
 * Base for every persisted document. Subclasses MUST be decorated with
 * `@Schema(baseSchemaOptions)` (or spread it) so timestamps are enabled.
 *
 * - `_id` is a UUID string, not an ObjectId: the mobile app generates ids offline
 *   and the server keeps them as-is. Server-created docs get a v4 UUID by default.
 * - Deletes are ALWAYS logical (`deletedAt`): sync pull must see deletions to propagate them.
 *   There is intentionally NO global query hook hiding deleted docs — filter with `notDeleted()`.
 *
 * Sync gotcha: conflict resolution is last-write-wins on the CLIENT's `updatedAt`.
 * Mongoose timestamps overwrite `updatedAt` on save, so sync writes must pass
 * `{ timestamps: false }` and set `updatedAt` explicitly.
 */
export abstract class BaseSchema {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  /** Not indexed on its own: almost always null, and every query already has a selective prefix. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

/** Base for documents owned by a user (routines, workouts, body metrics…). */
export abstract class UserOwnedSchema extends BaseSchema {
  /**
   * No single-field index: every user-owned collection declares a compound index starting with
   * `userId` (see docs/INDEXES.md), which serves `{ userId }` queries too.
   */
  @Prop({ type: String, required: true })
  userId!: string;
}

export const baseSchemaOptions = {
  timestamps: true,
  versionKey: false,
} as const;

/** Query fragment excluding soft-deleted documents. */
export function notDeleted<T>(filter: QueryFilter<T> = {}): QueryFilter<T> {
  return { ...filter, deletedAt: null };
}
