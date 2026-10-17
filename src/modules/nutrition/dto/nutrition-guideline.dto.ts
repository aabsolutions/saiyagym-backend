import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import { SLUG_PATTERN } from '../../exercises/dto/exercise-query.dto';
import { NUTRITION_GOALS, type NutritionGoal } from '../nutrition.constants';

export class GuidelineQueryDto {
  @ApiProperty({ enum: NUTRITION_GOALS, required: false })
  @IsOptional()
  @IsIn(NUTRITION_GOALS)
  goal?: NutritionGoal;
}

export class CreateGuidelineDto {
  @Matches(SLUG_PATTERN)
  @MaxLength(60)
  slug!: string;

  /** Goals it applies to; general advice lists all three. */
  @ApiProperty({ enum: NUTRITION_GOALS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(NUTRITION_GOALS, { each: true })
  goals!: NutritionGoal[];

  @ApiProperty({ type: Object })
  @IsTranslatable({ maxLength: 120 })
  title!: Translatable;

  @ApiProperty({ type: Object })
  @IsTranslatable({ maxLength: 300 })
  summary!: Translatable;

  /** Plain text, paragraphs separated by a blank line. */
  @ApiProperty({ type: Object })
  @IsTranslatable({ maxLength: 4000 })
  body!: Translatable;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateGuidelineDto extends PartialType(
  OmitType(CreateGuidelineDto, ['slug'] as const),
  { skipNullProperties: false },
) {}

// ---------- Responses ----------

export class GuidelineDto {
  id!: string;
  slug!: string;
  @ApiProperty({ enum: NUTRITION_GOALS, isArray: true }) goals!: NutritionGoal[];
  title!: string;
  summary!: string;
  body!: string;
}

export class GuidelineListDto {
  @ApiProperty({ type: [GuidelineDto] }) items!: GuidelineDto[];
  disclaimer!: string;
}

export class AdminGuidelineDto extends CreateGuidelineDto {
  id!: string;
  declare sortOrder: number;
  createdAt!: Date;
  updatedAt!: Date;
}
