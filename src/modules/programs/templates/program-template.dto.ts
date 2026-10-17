import { ApiExtraModels, ApiProperty, getSchemaPath, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { ProgressionRule } from '../../../common/constants/training';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import { SLUG_PATTERN } from '../../exercises/dto/exercise-query.dto';
import {
  DoubleProgressionRuleDto,
  PercentOf1RMRuleDto,
  progressionRuleType,
} from '../../routines/dto/progression-rule.dto';
import { TargetSetDto } from '../../routines/dto/routine.dto';
import { ProgramDeloadDto, ProgramDto, TrainingMaxDto } from '../dto/program.dto';
import {
  TEMPLATE_GOALS,
  TEMPLATE_LEVELS,
  type TemplateGoal,
  type TemplateLevel,
} from './program-template.schema';

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@ApiExtraModels(DoubleProgressionRuleDto, PercentOf1RMRuleDto)
export class TemplateExerciseDto {
  @Matches(SLUG_PATTERN)
  exerciseSlug!: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,40}$/)
  groupId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TargetSetDto)
  sets!: TargetSetDto[];

  @ApiProperty({
    required: false,
    nullable: true,
    oneOf: [
      { $ref: getSchemaPath(DoubleProgressionRuleDto) },
      { $ref: getSchemaPath(PercentOf1RMRuleDto) },
    ],
  })
  @IsOptional()
  @ValidateNested()
  @progressionRuleType()
  progression?: ProgressionRule | null;
}

export class TemplateRoutineDto {
  @Matches(KEY_PATTERN)
  @MaxLength(40)
  key!: string;

  @ApiProperty({ type: Object, example: { es: 'Empuje', en: 'Push' } })
  @IsTranslatable({ maxLength: 80 })
  name!: Translatable;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TemplateExerciseDto)
  exercises!: TemplateExerciseDto[];
}

export class TemplateDayDto {
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @Matches(KEY_PATTERN)
  routineKey!: string;
}

export class TemplateWeekDto {
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => TemplateDayDto)
  days!: TemplateDayDto[];
}

export class CreateProgramTemplateDto {
  @Matches(SLUG_PATTERN)
  @MaxLength(80)
  slug!: string;

  @ApiProperty({ type: Object })
  @IsTranslatable({ maxLength: 80 })
  name!: Translatable;

  @ApiProperty({ type: Object, required: false })
  @IsOptional()
  @IsTranslatable({ maxLength: 2000 })
  description?: Translatable;

  @ApiProperty({ enum: TEMPLATE_GOALS })
  @IsIn(TEMPLATE_GOALS)
  goal!: TemplateGoal;

  @ApiProperty({ enum: TEMPLATE_LEVELS })
  @IsIn(TEMPLATE_LEVELS)
  level!: TemplateLevel;

  @IsInt()
  @Min(1)
  @Max(52)
  durationWeeks!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => TemplateRoutineDto)
  routines!: TemplateRoutineDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(52)
  @ValidateNested({ each: true })
  @Type(() => TemplateWeekDto)
  weeks!: TemplateWeekDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProgramDeloadDto)
  deload?: ProgramDeloadDto;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateProgramTemplateDto extends PartialType(
  OmitType(CreateProgramTemplateDto, ['slug'] as const),
  { skipNullProperties: false },
) {}

export class CopyProgramTemplateDto {
  /** Defaults to the template's localized name. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  /** For %-based templates: your maxes for the main lifts (by exercise id). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TrainingMaxDto)
  trainingMaxes?: TrainingMaxDto[];
}

// ---------- Responses ----------

export class ProgramTemplateSummaryDto {
  id!: string;
  slug!: string;
  name!: string;
  description!: string;
  @ApiProperty({ enum: TEMPLATE_GOALS }) goal!: TemplateGoal;
  @ApiProperty({ enum: TEMPLATE_LEVELS }) level!: TemplateLevel;
  durationWeeks!: number;
  /** Max training days in any week. */
  daysPerWeek!: number;
  routineCount!: number;
  /** Contains progression rules: Free users get the routines without them. */
  usesAutoProgression!: boolean;
}

export class TemplateExerciseViewDto {
  exerciseSlug!: string;
  /** `null` if the exercise is no longer in the catalog (it will be skipped on copy). */
  @ApiProperty({ type: String, nullable: true }) exerciseId!: string | null;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) groupId!: string | null;
  notes!: string;
  @ApiProperty({ type: [TargetSetDto] }) sets!: TargetSetDto[];
  @ApiProperty({ type: Object, nullable: true }) progression!: ProgressionRule | null;
}

export class TemplateRoutineViewDto {
  key!: string;
  name!: string;
  @ApiProperty({ type: [TemplateExerciseViewDto] }) exercises!: TemplateExerciseViewDto[];
}

export class ProgramTemplateDetailDto extends ProgramTemplateSummaryDto {
  @ApiProperty({ type: [TemplateRoutineViewDto] }) routines!: TemplateRoutineViewDto[];
  @ApiProperty({ type: [TemplateWeekDto] }) weeks!: TemplateWeekDto[];
  deload!: ProgramDeloadDto;
}

export class CopyProgramTemplateResultDto {
  program!: ProgramDto;
  routineIds!: string[];
  /** Template exercises no longer in the catalog, left out of the copy. */
  skippedExercises!: string[];
  /** True when the user's plan lacks autoProgression and the rules were dropped. */
  progressionRulesDropped!: boolean;
}

/** Admin view: raw translation maps. */
export class AdminProgramTemplateDto extends OmitType(CreateProgramTemplateDto, [
  'deload',
] as const) {
  id!: string;
  deload!: ProgramDeloadDto;
  declare active: boolean;
  declare sortOrder: number;
  createdAt!: Date;
  updatedAt!: Date;
}
