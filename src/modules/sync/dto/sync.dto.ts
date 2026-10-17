import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import {
  PULL_COLLECTIONS,
  PUSH_COLLECTIONS,
  SYNC_OPS,
  type PushCollection,
  type SyncOp,
} from '../sync.types';

export const MAX_PUSH_CHANGES = 500;

export class SyncChangeDto {
  @ApiProperty({ enum: PUSH_COLLECTIONS })
  @IsIn(PUSH_COLLECTIONS)
  collection!: PushCollection;

  @ApiProperty({ enum: SYNC_OPS })
  @IsIn(SYNC_OPS)
  op!: SyncOp;

  /**
   * The document. Always: `id` (UUID v4, client-generated) and `updatedAt` (ISO, client clock —
   * decides conflicts). Upsert: the full document (same fields as the REST create body).
   * Delete: `id`, `updatedAt` and optionally `deletedAt`.
   */
  @ApiProperty({ type: Object, example: { id: 'uuid', updatedAt: '2026-10-13T10:00:00.000Z' } })
  @IsObject()
  doc!: Record<string, unknown>;
}

export class SyncPushDto {
  /** Applied in order. Each change succeeds or fails on its own. */
  @IsArray()
  @ArrayMaxSize(MAX_PUSH_CHANGES)
  @ValidateNested({ each: true })
  @Type(() => SyncChangeDto)
  changes!: SyncChangeDto[];
}

export const SYNC_RESULT_STATUSES = ['applied', 'ignored_older', 'error'] as const;
export type SyncResultStatus = (typeof SYNC_RESULT_STATUSES)[number];

export class SyncErrorDto {
  code!: string;
  message!: string;
  @ApiProperty({ required: false }) details?: unknown;
}

export class SyncResultDto {
  /** Position in the request's `changes`. */
  index!: number;
  @ApiProperty({ enum: PUSH_COLLECTIONS }) collection!: PushCollection;
  /** Stored id; may differ from the sent one (user_exercise_prefs are keyed by exerciseId). */
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  /**
   * `applied`: the server now holds this version (also for an exact replay — idempotent).
   * `ignored_older`: the server has a newer `updatedAt`; pull to get it.
   * `error`: rejected; see `error`.
   */
  @ApiProperty({ enum: SYNC_RESULT_STATUSES }) status!: SyncResultStatus;
  @ApiProperty({ type: SyncErrorDto, required: false }) error?: SyncErrorDto;
}

export class SyncPushResultDto {
  @ApiProperty({ type: [SyncResultDto] }) results!: SyncResultDto[];
  serverTime!: string;
}

export class SyncPullQueryDto {
  /** `serverTime` from the previous pull. Omit for a full sync. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  since?: Date;
}

export class SyncPullResultDto {
  /** Send as `since` next time. */
  serverTime!: string;
  /** Per collection: documents changed since `since`, deleted ones included (`deletedAt` set). */
  @ApiProperty({
    type: 'object',
    properties: Object.fromEntries(
      PULL_COLLECTIONS.map((c) => [c, { type: 'array', items: { type: 'object' } }]),
    ),
  })
  changes!: Record<string, Record<string, unknown>[]>;
}
