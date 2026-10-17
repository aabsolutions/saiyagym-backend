import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';
import { syncTrackingPlugin } from '../../../database/sync-tracking.plugin';
import {
  CATEGORIES,
  EQUIPMENT,
  MECHANICS,
  MUSCLES,
  TIERS,
  TRACKING_TYPES,
  type Category,
  type Equipment,
  type Mechanic,
  type Muscle,
  type Tier,
  type Tiers,
  type TrackingType,
} from '../exercise.constants';

@Schema({ _id: false })
export class ExerciseTiers implements Tiers {
  @Prop({ type: String, enum: [...TIERS, null], default: null }) hypertrophy!: Tier | null;
  @Prop({ type: String, enum: [...TIERS, null], default: null }) powerlifting!: Tier | null;
}

/**
 * Global exercises (`isGlobal`, admin-managed, have a `slug`) and user custom exercises
 * (`ownerId`, no slug, no tiers) share one collection so routines/workouts reference both alike.
 */
@Schema({ ...baseSchemaOptions, collection: 'exercises' })
export class Exercise extends BaseSchema {
  /** Stable id for global exercises (seed upserts by it). Kept on soft delete on purpose. */
  @Prop({ type: String, default: null, lowercase: true, trim: true })
  slug!: string | null;

  @Prop({ type: Object, required: true }) name!: Translatable;
  @Prop({ type: Object, default: () => ({}) }) description!: Translatable;
  @Prop({ type: Object, default: () => ({}) }) instructions!: Translatable;

  @Prop({ type: String, enum: MUSCLES, required: true }) primaryMuscle!: Muscle;
  @Prop({ type: [String], enum: MUSCLES, default: [] }) secondaryMuscles!: Muscle[];
  @Prop({ type: String, enum: EQUIPMENT, required: true }) equipment!: Equipment;
  @Prop({ type: String, enum: MECHANICS, required: true }) mechanic!: Mechanic;
  @Prop({ type: String, enum: CATEGORIES, required: true }) category!: Category;
  @Prop({ type: String, enum: TRACKING_TYPES, default: 'weight_reps' }) trackingType!: TrackingType;

  @Prop({ type: String, default: null }) imageUrl!: string | null;

  /** Tag slugs (see exercise_tags). */
  @Prop({ type: [String], default: [], index: true }) tags!: string[];

  @Prop({ type: SchemaFactory.createForClass(ExerciseTiers), default: () => ({}) })
  tiers!: ExerciseTiers;

  // Indexed through compounds: (isGlobal, deletedAt, primaryMuscle) and the sync plugin's
  // (ownerId, serverUpdatedAt).
  @Prop({ default: false }) isGlobal!: boolean;
  @Prop({ type: String, default: null }) ownerId!: string | null;
}

export type ExerciseDocument = HydratedDocument<Exercise>;
export const ExerciseSchema = SchemaFactory.createForClass(Exercise);
ExerciseSchema.plugin(syncTrackingPlugin, { ownerField: 'ownerId' });

// Unique among documents that have a slug (globals). Custom exercises have slug = null.
ExerciseSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
);

// MongoDB allows ONE text index per collection. `none` = no stemming/stop words: exercise
// names are short and mixed-language, so per-language stemming would do more harm than good.
// Text index v3 is case- and diacritic-insensitive ("búlgara" matches "bulgara").
ExerciseSchema.index(
  { 'name.es': 'text', 'name.en': 'text' },
  { name: 'exercise_name_text', default_language: 'none', weights: { 'name.es': 1, 'name.en': 1 } },
);

ExerciseSchema.index({ isGlobal: 1, deletedAt: 1, primaryMuscle: 1 });
