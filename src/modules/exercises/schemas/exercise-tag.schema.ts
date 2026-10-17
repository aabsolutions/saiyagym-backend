import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';

/** Admin-managed free tags ("básico", "unilateral", "lumbar-friendly"). Exercises store the slug. */
@Schema({ ...baseSchemaOptions, collection: 'exercise_tags' })
export class ExerciseTag extends BaseSchema {
  /** Kept on soft delete, so a deleted slug stays reserved (seed won't resurrect it). */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: Object, required: true })
  name!: Translatable;
}

export type ExerciseTagDocument = HydratedDocument<ExerciseTag>;
export const ExerciseTagSchema = SchemaFactory.createForClass(ExerciseTag);
