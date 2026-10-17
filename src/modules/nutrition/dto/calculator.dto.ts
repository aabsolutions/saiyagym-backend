import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
  ACTIVITY_FACTORS,
  ACTIVITY_LEVELS,
  CALCULATOR_BOUNDS,
  FORMULA_SEXES,
  NUTRITION_GOALS,
  type ActivityLevel,
  type FormulaSex,
  type NutritionGoal,
} from '../nutrition.constants';
import type { CalculatorField, FieldSource } from '../nutrition-calculator';

/**
 * Omitted fields are taken from the profile (sex, birth date → age, height) and the latest body
 * metric (weight). Sent values are used for this calculation only — nothing is stored.
 */
export class CalculatorRequestDto {
  @ApiProperty({ enum: NUTRITION_GOALS })
  @IsIn(NUTRITION_GOALS)
  goal!: NutritionGoal;

  @ApiProperty({
    enum: ACTIVITY_LEVELS,
    description: `Multipliers: ${JSON.stringify(ACTIVITY_FACTORS)}`,
  })
  @IsIn(ACTIVITY_LEVELS)
  activityLevel!: ActivityLevel;

  /** The formula only defines male/female. */
  @ApiProperty({ enum: FORMULA_SEXES, required: false })
  @IsOptional()
  @IsIn(FORMULA_SEXES)
  sex?: FormulaSex;

  /** Mifflin-St Jeor is validated for adults. */
  @IsOptional()
  @IsInt()
  @Min(CALCULATOR_BOUNDS.ageYears.min)
  @Max(CALCULATOR_BOUNDS.ageYears.max)
  ageYears?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(CALCULATOR_BOUNDS.heightCm.min)
  @Max(CALCULATOR_BOUNDS.heightCm.max)
  heightCm?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(CALCULATOR_BOUNDS.weightKg.min)
  @Max(CALCULATOR_BOUNDS.weightKg.max)
  weightKg?: number;
}

export class CalculatorInputDto {
  @ApiProperty({ enum: FORMULA_SEXES }) sex!: FormulaSex;
  ageYears!: number;
  heightCm!: number;
  weightKg!: number;
  @ApiProperty({ enum: ACTIVITY_LEVELS }) activityLevel!: ActivityLevel;
  activityFactor!: number;
  @ApiProperty({ enum: NUTRITION_GOALS }) goal!: NutritionGoal;
  /** Where each value came from: `request`, `profile` or `body_metrics`. */
  @ApiProperty({ type: Object, example: { sex: 'profile', weightKg: 'request' } })
  sources!: Record<CalculatorField, FieldSource>;
}

export class MacroSplitDto {
  proteinG!: number;
  carbsG!: number;
  fatG!: number;
  proteinPercent!: number;
  carbsPercent!: number;
  fatPercent!: number;
}

export class CalculatorResponseDto {
  @ApiProperty({ enum: ['mifflin_st_jeor'] }) formula!: 'mifflin_st_jeor';
  input!: CalculatorInputDto;
  bmrKcal!: number;
  tdeeKcal!: number;
  targetKcal!: number;
  /** The goal's deficit would go below the BMR; the target was raised to the BMR. */
  clampedToBmr!: boolean;
  macros!: MacroSplitDto;
  /** Translated "orientative, consult a professional" notice. Clients must show it. */
  disclaimer!: string;
}
