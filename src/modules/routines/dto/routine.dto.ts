import { ApiExtraModels, ApiProperty, getSchemaPath, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { SET_TYPES, type ProgressionRule, type SetType } from '../../../common/constants/training';
import {
  DoubleProgressionRuleDto,
  PercentOf1RMRuleDto,
  progressionRuleType,
} from './progression-rule.dto';

export class TargetSetDto {
  @ApiProperty({ enum: SET_TYPES })
  @IsIn(SET_TYPES)
  type!: SetType;

  @IsInt()
  @Min(1)
  @Max(100)
  repsMin!: number;

  /** Must be ≥ repsMin. Use repsMin = repsMax for a fixed rep target. */
  @IsInt()
  @Min(1)
  @Max(100)
  repsMax!: number;

  /** Suggested weight in kg. Mutually exclusive with percent1RM. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1000)
  weightKg?: number | null;

  /** % of the reference max (training max or estimated 1RM). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(10)
  @Max(110)
  percent1RM?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1800)
  restSeconds?: number;
}

@ApiExtraModels(DoubleProgressionRuleDto, PercentOf1RMRuleDto)
export class RoutineExerciseDto {
  /** Slot id; generated if omitted. Keep it stable across edits (workouts reference it). */
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsUUID('4')
  exerciseId!: string;

  /** Same groupId = superset. Members must be contiguous. */
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

  /** Premium (`autoProgression`). `null` removes it. */
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

export class CreateRoutineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RoutineExerciseDto)
  exercises!: RoutineExerciseDto[];
}

/** Sync payload: the full routine state, archive flag included. */
export class SyncRoutineDto extends CreateRoutineDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  archivedAt?: Date | null;
}

/** `exercises`, when sent, replaces the whole list (send stable slot ids to keep them). */
export class UpdateRoutineDto extends PartialType(CreateRoutineDto, {
  skipNullProperties: false,
}) {}

export class ReorderRoutineExercisesDto {
  /** Every slot id of the routine, exactly once, in the new order. */
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  itemIds!: string[];
}

export const ARCHIVED_FILTERS = ['false', 'true', 'all'] as const;

export class RoutineListQueryDto extends PaginationQueryDto {
  /** `false` (default): active only · `true`: archived only · `all`. */
  @IsOptional()
  @IsIn(ARCHIVED_FILTERS)
  archived: (typeof ARCHIVED_FILTERS)[number] = 'false';
}

// ---------- Responses ----------

export class RoutineSetResponseDto {
  @ApiProperty({ enum: SET_TYPES }) type!: SetType;
  repsMin!: number;
  repsMax!: number;
  @ApiProperty({ type: Number, nullable: true }) weightKg!: number | null;
  @ApiProperty({ type: Number, nullable: true }) percent1RM!: number | null;
  restSeconds!: number;
}

/** Localized snapshot of the referenced exercise; `null` if it was deleted. */
export class RoutineExerciseInfoDto {
  name!: string;
  primaryMuscle!: string;
  equipment!: string;
  mechanic!: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
}

@ApiExtraModels(DoubleProgressionRuleDto, PercentOf1RMRuleDto)
export class RoutineExerciseResponseDto {
  id!: string;
  exerciseId!: string;
  @ApiProperty({ type: RoutineExerciseInfoDto, nullable: true })
  exercise!: RoutineExerciseInfoDto | null;
  @ApiProperty({ type: String, nullable: true }) groupId!: string | null;
  notes!: string;
  @ApiProperty({ type: [RoutineSetResponseDto] }) sets!: RoutineSetResponseDto[];
  @ApiProperty({
    nullable: true,
    oneOf: [
      { $ref: getSchemaPath(DoubleProgressionRuleDto) },
      { $ref: getSchemaPath(PercentOf1RMRuleDto) },
    ],
  })
  progression!: ProgressionRule | null;
}

export class RoutineSummaryDto {
  id!: string;
  name!: string;
  notes!: string;
  exerciseCount!: number;
  setCount!: number;
  archived!: boolean;
  updatedAt!: Date;
}

export class RoutineDetailDto {
  id!: string;
  name!: string;
  notes!: string;
  archived!: boolean;
  @ApiProperty({ type: [RoutineExerciseResponseDto] }) exercises!: RoutineExerciseResponseDto[];
  createdAt!: Date;
  updatedAt!: Date;
}

export class RoutinePageDto {
  @ApiProperty({ type: [RoutineSummaryDto] }) items!: RoutineSummaryDto[];
  meta!: PageMetaDto;
}
