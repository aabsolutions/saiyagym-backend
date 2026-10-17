import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';
import { syncTrackingPlugin } from '../../../database/sync-tracking.plugin';
import { TIERS, type Tier } from '../exercise.constants';

/** Per-user overlay on an exercise: favorite flag and personal tier. One doc per (user, exercise). */
@Schema({ ...baseSchemaOptions, collection: 'user_exercise_prefs' })
export class UserExercisePref extends UserOwnedSchema {
  @Prop({ required: true })
  exerciseId!: string;

  @Prop({ default: false })
  isFavorite!: boolean;

  @Prop({ type: String, enum: [...TIERS, null], default: null })
  personalTier!: Tier | null;
}

export type UserExercisePrefDocument = HydratedDocument<UserExercisePref>;
export const UserExercisePrefSchema = SchemaFactory.createForClass(UserExercisePref);
UserExercisePrefSchema.plugin(syncTrackingPlugin);
UserExercisePrefSchema.index({ userId: 1, exerciseId: 1 }, { unique: true });
UserExercisePrefSchema.index({ userId: 1, isFavorite: 1 });
