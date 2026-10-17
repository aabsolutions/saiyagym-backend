import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';

export const ACTION_TOKEN_PURPOSES = ['email_verification', 'password_reset'] as const;
export type ActionTokenPurpose = (typeof ACTION_TOKEN_PURPOSES)[number];

/** Single-use, expiring tokens sent by email. Only the SHA-256 of the secret is stored. */
@Schema({ ...baseSchemaOptions, collection: 'action_tokens' })
export class ActionToken extends UserOwnedSchema {
  @Prop({ type: String, enum: ACTION_TOKEN_PURPOSES, required: true })
  purpose!: ActionTokenPurpose;

  @Prop({ required: true, select: false })
  tokenHash!: string;

  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export type ActionTokenDocument = HydratedDocument<ActionToken>;
export const ActionTokenSchema = SchemaFactory.createForClass(ActionToken);
ActionTokenSchema.index({ userId: 1, purpose: 1 });
