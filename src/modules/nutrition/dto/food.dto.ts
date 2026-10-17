import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import { SLUG_PATTERN } from '../../exercises/dto/exercise-query.dto';
import {
  FOOD_CATEGORIES,
  FOOD_TAGS,
  type FoodCategory,
  type FoodTag,
} from '../nutrition.constants';

/** `?tag=a&tag=b` arrives as an array, `?tag=a` as a string. */
const QueryArray = () =>
  Transform(({ value }: { value: unknown }) =>
    value === undefined || Array.isArray(value) ? value : [value],
  );

export class FoodQueryDto extends PaginationQueryDto {
  /** Partial, accent-insensitive match on the name in any language. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  @ApiProperty({ enum: FOOD_CATEGORIES, required: false })
  @IsOptional()
  @IsIn(FOOD_CATEGORIES)
  category?: FoodCategory;

  /** Repeatable (`?tag=vegan&tag=gluten-free`); a food must have ALL of them. */
  @ApiProperty({ enum: FOOD_TAGS, isArray: true, required: false })
  @IsOptional()
  @QueryArray()
  @IsArray()
  @ArrayMaxSize(FOOD_TAGS.length)
  @IsIn(FOOD_TAGS, { each: true })
  tag?: FoodTag[];
}

export class Per100gDto {
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(900) kcal!: number;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(100) proteinG!: number;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(100) carbsG!: number;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(100) fatG!: number;
}

export class CreateFoodDto {
  /** Immutable, e.g. `chicken-breast`. */
  @Matches(SLUG_PATTERN)
  @MaxLength(60)
  slug!: string;

  @ApiProperty({ type: Object, example: { es: 'Pechuga de pollo', en: 'Chicken breast' } })
  @IsTranslatable({ maxLength: 80 })
  name!: Translatable;

  @ApiProperty({ enum: FOOD_CATEGORIES })
  @IsIn(FOOD_CATEGORIES)
  category!: FoodCategory;

  @ValidateNested()
  @Type(() => Per100gDto)
  per100g!: Per100gDto;

  @ApiProperty({ enum: FOOD_TAGS, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(FOOD_TAGS, { each: true })
  tags?: FoodTag[];
}

export class UpdateFoodDto extends PartialType(OmitType(CreateFoodDto, ['slug'] as const), {
  skipNullProperties: false,
}) {}

// ---------- Responses ----------

export class FoodDto {
  id!: string;
  slug!: string;
  name!: string;
  @ApiProperty({ enum: FOOD_CATEGORIES }) category!: FoodCategory;
  per100g!: Per100gDto;
  @ApiProperty({ enum: FOOD_TAGS, isArray: true }) tags!: FoodTag[];
}

export class FoodPageDto {
  @ApiProperty({ type: [FoodDto] }) items!: FoodDto[];
  meta!: PageMetaDto;
}

/** Admin view: raw translation map. */
export class AdminFoodDto extends OmitType(FoodDto, ['name'] as const) {
  @ApiProperty({ type: Object }) name!: Translatable;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AdminFoodPageDto {
  @ApiProperty({ type: [AdminFoodDto] }) items!: AdminFoodDto[];
  meta!: PageMetaDto;
}
