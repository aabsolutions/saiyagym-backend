import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { Translatable } from '../../../common/utils/translatable.util';
import { BaseSchema, baseSchemaOptions } from '../../../database/base.schema';
import {
  FOOD_CATEGORIES,
  FOOD_TAGS,
  type FoodCategory,
  type FoodTag,
} from '../nutrition.constants';

/** Macros per 100 g of edible portion. kcal and grams. */
@Schema({ _id: false })
export class Per100g {
  @Prop({ type: Number, required: true, min: 0, max: 900 }) kcal!: number;
  @Prop({ type: Number, required: true, min: 0, max: 100 }) proteinG!: number;
  @Prop({ type: Number, required: true, min: 0, max: 100 }) carbsG!: number;
  @Prop({ type: Number, required: true, min: 0, max: 100 }) fatG!: number;
}
const Per100gSchema = SchemaFactory.createForClass(Per100g);

/** Static, admin-managed food database (SPEC: general suggestions, no daily logging). */
@Schema({ ...baseSchemaOptions, collection: 'foods' })
export class Food extends BaseSchema {
  /** Kept on soft delete: a deleted slug stays reserved (seed won't resurrect it). */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: Object, required: true })
  name!: Translatable;

  @Prop({ type: String, enum: FOOD_CATEGORIES, required: true, index: true })
  category!: FoodCategory;

  @Prop({ type: Per100gSchema, required: true })
  per100g!: Per100g;

  @Prop({ type: [String], enum: FOOD_TAGS, default: [], index: true })
  tags!: FoodTag[];

  /**
   * Every translation of the name, lowercased and without diacritics ("platano banana").
   * Derived on every write via `foodSearchText()` — never set by hand. Lets `q` match
   * partial words and ignore accents with a plain escaped regex.
   */
  @Prop({ type: String, default: '', select: false })
  searchText!: string;
}

export type FoodDocument = HydratedDocument<Food>;
export const FoodSchema = SchemaFactory.createForClass(Food);
