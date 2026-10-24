import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';
import type { Entitlements } from '../plan-entitlements';

@Schema({ _id: false })
export class PlanLimits {
  @Prop({ type: Number, default: null, min: 0 }) routines!: number | null;
  @Prop({ type: Number, default: null, min: 0 }) activePrograms!: number | null;
  @Prop({ type: Number, default: null, min: 0 }) customExercises!: number | null;
}

@Schema({ _id: false })
export class PlanFeatures {
  @Prop({ default: false }) progressPhotos!: boolean;
  @Prop({ default: false }) autoProgression!: boolean;
  @Prop({ default: false }) fullStats!: boolean;
  @Prop({ default: false }) fullNutrition!: boolean;
  @Prop({ default: false }) dataExport!: boolean;
  @Prop({ default: false }) premiumSounds!: boolean;
}

@Schema({ _id: false })
export class PlanEntitlements implements Entitlements {
  @Prop({ type: SchemaFactory.createForClass(PlanLimits), default: () => ({}) })
  limits!: PlanLimits;

  @Prop({ type: Number, default: null, min: 1 })
  statsHistoryDays!: number | null;

  /**
   * Default 0 (no guides) on purpose: plans saved before the field existed fail CLOSED until
   * `npm run db:backfill-guides-limit` sets them.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  guidesPerRoutine!: number | null;

  @Prop({ type: SchemaFactory.createForClass(PlanFeatures), default: () => ({}) })
  features!: PlanFeatures;
}

@Schema({ ...baseSchemaOptions, collection: 'plans' })
export class Plan extends BaseSchema {
  /** Stable machine identifier (`free`, `premium`). Clients may branch on it. */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  code!: string;

  @Prop({ type: Object, required: true })
  name!: Translatable;

  @Prop({ type: Object, default: () => ({ es: '' }) })
  description!: Translatable;

  @Prop({ type: SchemaFactory.createForClass(PlanEntitlements), required: true })
  entitlements!: PlanEntitlements;

  /** Exactly one plan is the default: assigned on sign-up and used as fallback. */
  @Prop({ default: false, index: true })
  isDefault!: boolean;

  /** Inactive plans are hidden from the public catalog and can't be newly assigned. */
  @Prop({ default: true })
  active!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;
}

export type PlanDocument = HydratedDocument<Plan>;
export const PlanSchema = SchemaFactory.createForClass(Plan);
