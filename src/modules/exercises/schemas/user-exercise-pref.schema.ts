import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';
import { syncTrackingPlugin } from '../../../database/sync-tracking.plugin';
import { ExerciseTiers } from './exercise.schema';

/**
 * Per-user overlay on an exercise: favorite flag and personal tiers. One doc per (user, exercise).
 * Personal tiers are per goal, like the global ones: a curl can be A for hypertrophy and C for
 * powerlifting. `null` for a goal = use the global tier.
 */
@Schema({ ...baseSchemaOptions, collection: 'user_exercise_prefs' })
export class UserExercisePref extends UserOwnedSchema {
  @Prop({ required: true })
  exerciseId!: string;

  @Prop({ default: false })
  isFavorite!: boolean;

  @Prop({ type: SchemaFactory.createForClass(ExerciseTiers), default: () => ({}) })
  personalTiers!: ExerciseTiers;
}

export type UserExercisePrefDocument = HydratedDocument<UserExercisePref>;
export const UserExercisePrefSchema = SchemaFactory.createForClass(UserExercisePref);
UserExercisePrefSchema.plugin(syncTrackingPlugin);
UserExercisePrefSchema.index({ userId: 1, exerciseId: 1 }, { unique: true });
UserExercisePrefSchema.index({ userId: 1, isFavorite: 1 });
