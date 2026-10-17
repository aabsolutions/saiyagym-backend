import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';
import {
  MEAL_TYPES,
  NUTRITION_GOALS,
  type MealType,
  type NutritionGoal,
} from '../nutrition.constants';

/** References the food by slug (stable across environments, like program templates → exercises). */
@Schema({ _id: false })
export class MealItem {
  @Prop({ type: String, required: true }) foodSlug!: string;
  @Prop({ type: Number, required: true, min: 1, max: 2000 }) grams!: number;
}
const MealItemSchema = SchemaFactory.createForClass(MealItem);

/**
 * A sample meal for a goal and meal type. Totals are computed on read from the current food
 * macros, so correcting a food fixes every suggestion that uses it.
 */
@Schema({ ...baseSchemaOptions, collection: 'meal_suggestions' })
export class MealSuggestion extends BaseSchema {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: Object, required: true })
  name!: Translatable;

  @Prop({ type: Object, default: {} })
  description!: Translatable;

  @Prop({ type: String, enum: NUTRITION_GOALS, required: true })
  goal!: NutritionGoal;

  @Prop({ type: String, enum: MEAL_TYPES, required: true })
  mealType!: MealType;

  @Prop({ type: [MealItemSchema], required: true })
  items!: MealItem[];

  /** Visible on plans without `fullNutrition` (the Free preview). Admin-chosen. */
  @Prop({ type: Boolean, default: false })
  isSample!: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder!: number;
}

export type MealSuggestionDocument = HydratedDocument<MealSuggestion>;
export const MealSuggestionSchema = SchemaFactory.createForClass(MealSuggestion);
MealSuggestionSchema.index({ goal: 1, mealType: 1, sortOrder: 1 });
MealSuggestionSchema.index({ 'items.foodSlug': 1 });
