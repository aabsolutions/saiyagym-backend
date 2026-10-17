import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { DELOAD_MODES, type DeloadMode } from '../../../common/constants/training';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';
import { syncTrackingPlugin } from '../../../database/sync-tracking.plugin';

export const PROGRAM_STATUSES = ['draft', 'active', 'completed'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

@Schema({ _id: false })
export class ProgramDay {
  /** ISO weekday: 1 = Monday … 7 = Sunday. Unique within a week. */
  @Prop({ required: true, min: 1, max: 7 }) weekday!: number;
  @Prop({ required: true }) routineId!: string;
  @Prop({ type: String, default: null }) label!: string | null;
}

@Schema({ _id: false })
export class ProgramWeek {
  @Prop({ type: [SchemaFactory.createForClass(ProgramDay)], default: [] }) days!: ProgramDay[];
}

/** Which weeks are deload weeks and how to deload (exercise rules may override the how). */
@Schema({ _id: false })
export class ProgramDeload {
  /** 1-based week numbers. */
  @Prop({ type: [Number], default: [] }) weeks!: number[];
  @Prop({ type: String, enum: DELOAD_MODES, default: 'weight' }) mode!: DeloadMode;
  @Prop({ default: 40, min: 5, max: 90 }) percent!: number;
}

/** User-declared max for %-based prescriptions (wins over the history estimate). */
@Schema({ _id: false })
export class TrainingMax {
  @Prop({ required: true }) exerciseId!: string;
  @Prop({ required: true, min: 1 }) kg!: number;
}

@Schema({ ...baseSchemaOptions, collection: 'programs' })
export class Program extends UserOwnedSchema {
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ type: String, default: '' }) notes!: string;
  @Prop({ required: true, min: 1, max: 52 }) durationWeeks!: number;
  /** Exactly `durationWeeks` entries. */
  @Prop({ type: [SchemaFactory.createForClass(ProgramWeek)], default: [] }) weeks!: ProgramWeek[];
  @Prop({ type: SchemaFactory.createForClass(ProgramDeload), default: () => ({}) })
  deload!: ProgramDeload;
  @Prop({ type: [SchemaFactory.createForClass(TrainingMax)], default: [] })
  trainingMaxes!: TrainingMax[];

  @Prop({ type: String, enum: PROGRAM_STATUSES, default: 'draft' })
  status!: ProgramStatus;
  /** Local calendar date ("YYYY-MM-DD") of day 1 — see program-schedule.ts for why not a Date. */
  @Prop({ type: String, default: null }) startDate!: string | null;
  @Prop({ type: Date, default: null }) activatedAt!: Date | null;
  @Prop({ type: Date, default: null }) completedAt!: Date | null;
  /** Source template, if copied from one. */
  @Prop({ type: String, default: null }) templateId!: string | null;
}

export type ProgramDocument = HydratedDocument<Program>;
export const ProgramSchema = SchemaFactory.createForClass(Program);
ProgramSchema.plugin(syncTrackingPlugin);
ProgramSchema.index({ userId: 1, deletedAt: 1, status: 1 });
ProgramSchema.index({ userId: 1, 'weeks.days.routineId': 1 });
