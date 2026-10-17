import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';

export const REVOKE_REASONS = [
  /** Exchanged for a new token. Presenting it again = theft → whole family revoked. */
  'rotated',
  'logout',
  'logout_all',
  'password_changed',
  'account_deleted',
  'reuse_detected',
] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

/**
 * One row per refresh token. A login starts a *family* (= session, `familyId`);
 * every rotation adds a row to it. Only the SHA-256 of the secret is stored.
 */
@Schema({ ...baseSchemaOptions, collection: 'refresh_tokens' })
export class RefreshToken extends UserOwnedSchema {
  @Prop({ required: true, index: true })
  familyId!: string;

  @Prop({ required: true, select: false })
  tokenHash!: string;

  /** TTL index: MongoDB deletes the row once expired; nothing to clean up by hand. */
  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, enum: [...REVOKE_REASONS, null], default: null })
  revokedReason!: RevokeReason | null;

  @Prop({ type: String, default: null })
  replacedById!: string | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;

  @Prop({ type: String, default: null })
  ip!: string | null;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });
