import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
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
  MEAL_TYPES,
  NUTRITION_GOALS,
  type MealType,
  type NutritionGoal,
} from '../nutrition.constants';
import type { Macros } from '../nutrition.util';

export class MealSuggestionQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: NUTRITION_GOALS, required: false })
  @IsOptional()
  @IsIn(NUTRITION_GOALS)
  goal?: NutritionGoal;

  @ApiProperty({ enum: MEAL_TYPES, required: false })
  @IsOptional()
  @IsIn(MEAL_TYPES)
  mealType?: MealType;
}

export class MealItemDto {
  @Matches(SLUG_PATTERN)
  @MaxLength(60)
  foodSlug!: string;

  @IsInt()
  @Min(1)
  @Max(2000)
  grams!: number;
}

export class CreateMealSuggestionDto {
  @Matches(SLUG_PATTERN)
  @MaxLength(60)
  slug!: string;

  @ApiProperty({ type: Object })
  @IsTranslatable({ maxLength: 120 })
  name!: Translatable;

  @ApiProperty({ type: Object, required: false })
  @IsOptional()
  @IsTranslatable({ maxLength: 1000 })
  description?: Translatable;

  @ApiProperty({ enum: NUTRITION_GOALS })
  @IsIn(NUTRITION_GOALS)
  goal!: NutritionGoal;

  @ApiProperty({ enum: MEAL_TYPES })
  @IsIn(MEAL_TYPES)
  mealType!: MealType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MealItemDto)
  items!: MealItemDto[];

  /** Shown to plans without `fullNutrition` (the Free preview). */
  @IsOptional()
  @IsBoolean()
  isSample?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateMealSuggestionDto extends PartialType(
  OmitType(CreateMealSuggestionDto, ['slug'] as const),
  { skipNullProperties: false },
) {}

// ---------- Responses ----------

export class MacrosDto implements Macros {
  kcal!: number;
  proteinG!: number;
  carbsG!: number;
  fatG!: number;
}

export class MealItemViewDto extends MacrosDto {
  foodId!: string;
  foodSlug!: string;
  name!: string;
  grams!: number;
}

export class MealSuggestionDto {
  id!: string;
  slug!: string;
  name!: string;
  description!: string;
  @ApiProperty({ enum: NUTRITION_GOALS }) goal!: NutritionGoal;
  @ApiProperty({ enum: MEAL_TYPES }) mealType!: MealType;
  /** Items whose food was removed from the catalog are left out. */
  @ApiProperty({ type: [MealItemViewDto] }) items!: MealItemViewDto[];
  totals!: MacrosDto;
  isSample!: boolean;
}

export class MealSuggestionPageDto {
  @ApiProperty({ type: [MealSuggestionDto] }) items!: MealSuggestionDto[];
  meta!: PageMetaDto;
  /** True when the plan lacks `fullNutrition` and only sample suggestions are listed. */
  limitedByPlan!: boolean;
  /** Suggestions matching the filters that the plan doesn't unlock (0 when not limited). */
  lockedCount!: number;
  disclaimer!: string;
}

export class AdminMealSuggestionDto extends CreateMealSuggestionDto {
  id!: string;
  declare description: Translatable;
  declare isSample: boolean;
  declare sortOrder: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AdminMealSuggestionPageDto {
  @ApiProperty({ type: [AdminMealSuggestionDto] }) items!: AdminMealSuggestionDto[];
  meta!: PageMetaDto;
}
