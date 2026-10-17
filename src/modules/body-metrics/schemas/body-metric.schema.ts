import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';
import { syncTrackingPlugin } from '../../../database/sync-tracking.plugin';

/** Measurement fields (SPEC). Always kg / cm / %; unit conversion is presentation-only. */
export const MEASUREMENT_FIELDS = [
  'weightKg',
  'bodyFatPercent',
  'waistCm',
  'chestCm',
  'hipsCm',
  'armCm',
  'thighCm',
  'calfCm',
  'neckCm',
] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

/** One measurement entry; any subset of fields may be recorded. */
@Schema({ ...baseSchemaOptions, collection: 'body_metrics' })
export class BodyMetric extends UserOwnedSchema {
  @Prop({ type: Date, required: true }) measuredAt!: Date;
  @Prop({ type: Number, default: null }) weightKg!: number | null;
  @Prop({ type: Number, default: null }) bodyFatPercent!: number | null;
  @Prop({ type: Number, default: null }) waistCm!: number | null;
  @Prop({ type: Number, default: null }) chestCm!: number | null;
  @Prop({ type: Number, default: null }) hipsCm!: number | null;
  @Prop({ type: Number, default: null }) armCm!: number | null;
  @Prop({ type: Number, default: null }) thighCm!: number | null;
  @Prop({ type: Number, default: null }) calfCm!: number | null;
  @Prop({ type: Number, default: null }) neckCm!: number | null;
  @Prop({ type: String, default: '' }) notes!: string;
}

export type BodyMetricDocument = HydratedDocument<BodyMetric>;
export const BodyMetricSchema = SchemaFactory.createForClass(BodyMetric);
BodyMetricSchema.plugin(syncTrackingPlugin);
BodyMetricSchema.index({ userId: 1, measuredAt: -1 });
