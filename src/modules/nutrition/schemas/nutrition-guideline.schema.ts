import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';
import { NUTRITION_GOALS, type NutritionGoal } from '../nutrition.constants';

/** Short article (daily protein, hydration, timing…). Available on every plan. */
@Schema({ ...baseSchemaOptions, collection: 'nutrition_guidelines' })
export class NutritionGuideline extends BaseSchema {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  /** Goals it applies to; general advice lists all of them. */
  @Prop({ type: [String], enum: NUTRITION_GOALS, required: true, index: true })
  goals!: NutritionGoal[];

  @Prop({ type: Object, required: true })
  title!: Translatable;

  @Prop({ type: Object, required: true })
  summary!: Translatable;

  /** Plain text, paragraphs separated by blank lines. */
  @Prop({ type: Object, required: true })
  body!: Translatable;

  @Prop({ type: Number, default: 0 })
  sortOrder!: number;
}

export type NutritionGuidelineDocument = HydratedDocument<NutritionGuideline>;
export const NutritionGuidelineSchema = SchemaFactory.createForClass(NutritionGuideline);
