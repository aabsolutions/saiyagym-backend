import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';

export const PHOTO_VIEWS = ['front', 'side', 'back'] as const;
export type PhotoView = (typeof PHOTO_VIEWS)[number];

/** Premium. The image lives in Cloudinary as a PRIVATE (authenticated) asset in the user's folder. */
@Schema({ ...baseSchemaOptions, collection: 'progress_photos' })
export class ProgressPhoto extends UserOwnedSchema {
  @Prop({ type: String, enum: PHOTO_VIEWS, required: true }) view!: PhotoView;
  @Prop({ type: Date, required: true }) takenAt!: Date;
  /** Cloudinary public id (validated to be inside the user's private folder). */
  @Prop({ required: true }) publicId!: string;
  @Prop({ required: true }) format!: string;
  /** URL returned by Cloudinary at upload time (reads use a freshly signed URL instead). */
  @Prop({ required: true }) url!: string;
  @Prop({ type: String, default: '' }) notes!: string;
}

export type ProgressPhotoDocument = HydratedDocument<ProgressPhoto>;
export const ProgressPhotoSchema = SchemaFactory.createForClass(ProgressPhoto);
ProgressPhotoSchema.index({ userId: 1, view: 1, takenAt: -1 });
