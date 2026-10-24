import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
import {
  DELOAD_MODES,
  SET_TYPES,
  type DeloadMode,
  type SetType,
} from '../../../common/constants/training';
import { RoundDecimals } from '../../../common/decorators/round-decimals.decorator';
import { PROGRAM_STATUSES, type ProgramStatus } from '../schemas/program.schema';

export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ProgramDayDto {
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @IsUUID('4')
  routineId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string | null;
}

export class ProgramWeekDto {
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ProgramDayDto)
  days!: ProgramDayDto[];
}

export class ProgramDeloadDto {
  /** 1-based week numbers. */
  @IsArray()
  @ArrayMaxSize(52)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  weeks!: number[];

  @ApiProperty({ enum: DELOAD_MODES })
  @IsIn(DELOAD_MODES)
  mode!: DeloadMode;

  @IsNumber()
  @Min(5)
  @Max(90)
  percent!: number;
}

export class TrainingMaxDto {
  @IsUUID('4')
  exerciseId!: string;

  @RoundDecimals(2)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000)
  kg!: number;
}

export class CreateProgramDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsInt()
  @Min(1)
  @Max(52)
  durationWeeks!: number;

  /** Exactly `durationWeeks` entries; week N = weeks[N-1]. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(52)
  @ValidateNested({ each: true })
  @Type(() => ProgramWeekDto)
  weeks!: ProgramWeekDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProgramDeloadDto)
  deload?: ProgramDeloadDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TrainingMaxDto)
  trainingMaxes?: TrainingMaxDto[];
}

export class UpdateProgramDto extends PartialType(CreateProgramDto, {
  skipNullProperties: false,
}) {}

export class ActivateProgramDto {
  /** Local date of day 1 ("YYYY-MM-DD"). Defaults to today (UTC) — send the client's local date. */
  @IsOptional()
  @Matches(LOCAL_DATE_PATTERN)
  startDate?: string;
}

export class ProgramListQueryDto {
  @IsOptional()
  @IsIn(PROGRAM_STATUSES)
  status?: ProgramStatus;
}

export class TodayQueryDto {
  /** The client's local date ("YYYY-MM-DD"). Defaults to today in UTC. */
  @IsOptional()
  @Matches(LOCAL_DATE_PATTERN)
  date?: string;

  /** Only needed with several active programs (Premium); defaults to the latest activated. */
  @IsOptional()
  @IsUUID('4')
  programId?: string;
}

// ---------- Responses ----------

export class ProgramDayResponseDto extends ProgramDayDto {
  @ApiProperty({ type: String, nullable: true }) declare label: string | null;
  /** `null` if the routine was deleted. */
  @ApiProperty({ type: String, nullable: true }) routineName!: string | null;
}

export class ProgramWeekResponseDto {
  @ApiProperty({ type: [ProgramDayResponseDto] }) days!: ProgramDayResponseDto[];
}

export class ProgramDto {
  id!: string;
  name!: string;
  notes!: string;
  durationWeeks!: number;
  @ApiProperty({ type: [ProgramWeekResponseDto] }) weeks!: ProgramWeekResponseDto[];
  deload!: ProgramDeloadDto;
  @ApiProperty({ type: [TrainingMaxDto] }) trainingMaxes!: TrainingMaxDto[];
  @ApiProperty({ enum: PROGRAM_STATUSES }) status!: ProgramStatus;
  @ApiProperty({ type: String, nullable: true }) startDate!: string | null;
  @ApiProperty({ type: Date, nullable: true }) activatedAt!: Date | null;
  @ApiProperty({ type: Date, nullable: true }) completedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) templateId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PlannedSetDto {
  @ApiProperty({ enum: SET_TYPES }) type!: SetType;
  repsMin!: number;
  repsMax!: number;
  /** Target weight in kg; `null` when it can't be computed (e.g. %1RM without a reference max). */
  @ApiProperty({ type: Number, nullable: true }) weightKg!: number | null;
  restSeconds!: number;
}

export class ProgressionNoteDto {
  @ApiProperty({
    enum: [
      'PERCENT_OF_MAX',
      'NO_REFERENCE_MAX',
      'PROGRESSION_DISABLED',
      'NO_HISTORY',
      'INCREASE',
      'HOLD',
      'WEEK_PERCENT',
      'DELOAD_WEIGHT',
      'DELOAD_SETS',
    ],
  })
  code!: string;
  @ApiProperty({ type: Object, required: false }) params?: Record<string, number | string>;
}

export class ReferenceMaxDto {
  kg!: number;
  @ApiProperty({ enum: ['training_max', 'estimated'] }) source!: 'training_max' | 'estimated';
}

export class TodayExerciseDto {
  /** Routine slot id. */
  id!: string;
  exerciseId!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) groupId!: string | null;
  notes!: string;
  @ApiProperty({ type: String, nullable: true, enum: ['double_progression', 'percent_1rm'] })
  progressionType!: string | null;
  @ApiProperty({ type: ReferenceMaxDto, nullable: true }) referenceMax!: ReferenceMaxDto | null;
  /** Why the targets look the way they do (machine-readable). */
  @ApiProperty({ type: [ProgressionNoteDto] }) adjustments!: ProgressionNoteDto[];
  @ApiProperty({ type: [PlannedSetDto] }) sets!: PlannedSetDto[];
}

export class TodayRoutineDto {
  id!: string;
  name!: string;
  notes!: string;
  @ApiProperty({ type: [TodayExerciseDto] }) exercises!: TodayExerciseDto[];
}

export class TodayDto {
  programId!: string;
  programName!: string;
  date!: string;
  @ApiProperty({ enum: ['training', 'rest', 'not_started', 'finished'] }) status!: string;
  /** 1-based; null before start / after the end. */
  @ApiProperty({ type: Number, nullable: true }) week!: number | null;
  totalWeeks!: number;
  isDeloadWeek!: boolean;
  @ApiProperty({ type: Number, nullable: true }) startsInDays!: number | null;
  @ApiProperty({ type: String, nullable: true }) dayLabel!: string | null;
  /** Only on training days; `null` if the scheduled routine no longer exists. */
  @ApiProperty({ type: TodayRoutineDto, nullable: true }) routine!: TodayRoutineDto | null;
  /** Whether automatic progression applied (plan has autoProgression). */
  progressionEnabled!: boolean;
}
