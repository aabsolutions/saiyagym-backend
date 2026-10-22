import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';

export const SOUND_ACCESS = ['free', 'premium'] as const;
export type SoundAccess = (typeof SOUND_ACCESS)[number];

/**
 * An admin-managed rest-alarm sound. The audio lives in Cloudinary (`publicId`); `bytes`,
 * `durationSec` and `format` are what Cloudinary reported when the API verified the asset.
 * Not user-owned and not synced: clients fetch the list over REST and cache it.
 */
@Schema({ ...baseSchemaOptions, collection: 'rest_sounds' })
export class RestSound extends BaseSchema {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: Object, required: true })
  name!: Translatable;

  @Prop({ type: String, enum: SOUND_ACCESS, required: true })
  access!: SoundAccess;

  @Prop({ type: String, required: true })
  publicId!: string;

  @Prop({ type: String, required: true })
  format!: string;

  @Prop({ type: Number, required: true })
  durationSec!: number;

  @Prop({ type: Number, required: true })
  bytes!: number;

  @Prop({ type: Number, default: 0 })
  sortOrder!: number;
}

export type RestSoundDocument = HydratedDocument<RestSound>;
export const RestSoundSchema = SchemaFactory.createForClass(RestSound);
RestSoundSchema.index({ sortOrder: 1 });
