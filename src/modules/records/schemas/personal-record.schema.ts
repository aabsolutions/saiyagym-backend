import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { baseSchemaOptions, UserOwnedSchema } from '../../../database/base.schema';

@Schema({ _id: false })
export class RecordEntryDoc {
  @Prop({ required: true }) value!: number;
  @Prop({ required: true }) weightKg!: number;
  @Prop({ required: true }) reps!: number;
  @Prop({ required: true }) workoutId!: string;
  @Prop({ type: Date, required: true }) achievedAt!: Date;
}

const RecordEntrySchema = SchemaFactory.createForClass(RecordEntryDoc);

/**
 * Precomputed records (SPEC) — one document per (user, exercise), rebuilt from scratch whenever a
 * finished workout with that exercise changes. Derived data: safe to drop and recompute.
 */
@Schema({ ...baseSchemaOptions, collection: 'personal_records' })
export class PersonalRecord extends UserOwnedSchema {
  @Prop({ required: true }) exerciseId!: string;
  @Prop({ type: RecordEntrySchema, default: null }) maxWeight!: RecordEntryDoc | null;
  @Prop({ type: RecordEntrySchema, default: null }) bestE1RM!: RecordEntryDoc | null;
  @Prop({ type: RecordEntrySchema, default: null }) maxVolume!: RecordEntryDoc | null;
  @Prop({ type: [RecordEntrySchema], default: [] }) repsAtWeight!: RecordEntryDoc[];
}

export type PersonalRecordDocument = HydratedDocument<PersonalRecord>;
export const PersonalRecordSchema = SchemaFactory.createForClass(PersonalRecord);
// SPEC index; unique so concurrent recomputes upsert the same document.
PersonalRecordSchema.index({ userId: 1, exerciseId: 1 }, { unique: true });
