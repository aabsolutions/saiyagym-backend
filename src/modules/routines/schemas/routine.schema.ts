import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import {
  SET_TYPES,
  type ProgressionRule,
  type SetType,
  type TargetSet,
} from '../../../common/constants/training';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';
import { syncTrackingPlugin } from '../../../database/sync-tracking.plugin';

@Schema({ _id: false })
export class RoutineSet implements TargetSet {
  @Prop({ type: String, enum: SET_TYPES, required: true }) type!: SetType;
  @Prop({ required: true, min: 1 }) repsMin!: number;
  @Prop({ required: true, min: 1 }) repsMax!: number;
  /** Suggested weight (kg). Mutually exclusive with percent1RM. */
  @Prop({ type: Number, default: null }) weightKg!: number | null;
  @Prop({ type: Number, default: null }) percent1RM!: number | null;
  @Prop({ default: 120, min: 0 }) restSeconds!: number;
}

@Schema({ _id: false })
export class RoutineExercise {
  /** Stable id of this slot (client-visible; used for reordering and workout references). */
  @Prop({ required: true }) id!: string;
  @Prop({ required: true }) exerciseId!: string;
  /** Exercises sharing a groupId form a superset; they must be contiguous. */
  @Prop({ type: String, default: null }) groupId!: string | null;
  @Prop({ type: String, default: '' }) notes!: string;
  @Prop({ type: [SchemaFactory.createForClass(RoutineSet)], default: [] }) sets!: RoutineSet[];
  /** Premium. Validated by the DTO layer (discriminated union). */
  @Prop({ type: Object, default: null }) progression!: ProgressionRule | null;
}

/** A workout template. Exercises and target sets are EMBEDDED (SPEC). */
@Schema({ ...baseSchemaOptions, collection: 'routines' })
export class Routine extends UserOwnedSchema {
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ type: String, default: '' }) notes!: string;
  @Prop({ type: [SchemaFactory.createForClass(RoutineExercise)], default: [] })
  exercises!: RoutineExercise[];
  /** Archived routines are hidden by default and don't count toward the plan limit. */
  @Prop({ type: Date, default: null }) archivedAt!: Date | null;
}

export type RoutineDocument = HydratedDocument<Routine>;
export const RoutineSchema = SchemaFactory.createForClass(Routine);
RoutineSchema.plugin(syncTrackingPlugin);
RoutineSchema.index({ userId: 1, deletedAt: 1, archivedAt: 1 });
RoutineSchema.index({ userId: 1, updatedAt: 1 });
