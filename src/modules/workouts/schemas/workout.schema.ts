import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { SET_TYPES, type SetType } from '../../../common/constants/training';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';
import { syncTrackingPlugin } from '../../../database/sync-tracking.plugin';

/** SPEC per set: type, weightKg, reps, completed, completedAt. Always kg. */
@Schema({ _id: false })
export class WorkoutSet {
  /** Client-generated; lets the app match sets across edits. */
  @Prop({ required: true }) id!: string;
  @Prop({ type: String, enum: SET_TYPES, required: true }) type!: SetType;
  @Prop({ type: Number, default: null }) weightKg!: number | null;
  @Prop({ type: Number, default: null }) reps!: number | null;
  @Prop({ default: false }) completed!: boolean;
  @Prop({ type: Date, default: null }) completedAt!: Date | null;
}

@Schema({ _id: false })
export class WorkoutExercise {
  @Prop({ required: true }) id!: string;
  @Prop({ required: true }) exerciseId!: string;
  /** Routine slot this came from, if started from a routine. */
  @Prop({ type: String, default: null }) routineExerciseId!: string | null;
  @Prop({ type: String, default: null }) groupId!: string | null;
  @Prop({ type: String, default: '' }) notes!: string;
  @Prop({ type: [SchemaFactory.createForClass(WorkoutSet)], default: [] }) sets!: WorkoutSet[];
  /** Server-computed: Σ weight × reps over completed working sets. */
  @Prop({ default: 0 }) volumeKg!: number;
}

/** A logged session. Exercises and sets are EMBEDDED (SPEC). `finishedAt: null` = in progress. */
@Schema({ ...baseSchemaOptions, collection: 'workouts' })
export class Workout extends UserOwnedSchema {
  @Prop({ type: String, default: '', maxlength: 80 }) name!: string;
  @Prop({ type: String, default: null }) routineId!: string | null;
  @Prop({ type: String, default: null }) programId!: string | null;
  @Prop({ type: Date, required: true }) startedAt!: Date;
  @Prop({ type: Date, default: null }) finishedAt!: Date | null;
  /** Server-computed from startedAt/finishedAt; null while in progress. */
  @Prop({ type: Number, default: null }) durationSeconds!: number | null;
  @Prop({ type: String, default: '' }) notes!: string;
  /** 1–5. */
  @Prop({ type: Number, default: null, min: 1, max: 5 }) rating!: number | null;
  @Prop({ type: [SchemaFactory.createForClass(WorkoutExercise)], default: [] })
  exercises!: WorkoutExercise[];
  /** Server-computed totals over completed working sets. */
  @Prop({ default: 0 }) volumeKg!: number;
  @Prop({ default: 0 }) workingSets!: number;
}

export type WorkoutDocument = HydratedDocument<Workout>;
export const WorkoutSchema = SchemaFactory.createForClass(Workout);
WorkoutSchema.plugin(syncTrackingPlugin);
// SPEC minimum indexes.
WorkoutSchema.index({ userId: 1, startedAt: -1 });
WorkoutSchema.index({ userId: 1, 'exercises.exerciseId': 1, startedAt: -1 });
WorkoutSchema.index({ userId: 1, updatedAt: 1 });
