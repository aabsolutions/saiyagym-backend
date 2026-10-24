import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import { RoundDecimals } from '../../../common/decorators/round-decimals.decorator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { SET_TYPES, type SetType } from '../../../common/constants/training';

export class WorkoutSetDto {
  @IsUUID('4')
  id!: string;

  @ApiProperty({ enum: SET_TYPES })
  @IsIn(SET_TYPES)
  type!: SetType;

  /** kg (SPEC: always stored in kg). `null` for bodyweight / not entered. */
  @IsOptional()
  @RoundDecimals(3)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1000)
  weightKg?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  reps?: number | null;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  completedAt?: Date | null;
}

export class WorkoutExerciseDto {
  @IsUUID('4')
  id!: string;

  @IsUUID('4')
  exerciseId!: string;

  @IsOptional()
  @IsUUID('4')
  routineExerciseId?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,40}$/)
  groupId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WorkoutSetDto)
  sets!: WorkoutSetDto[];
}

/** The workout body: shared by REST create/update and sync push. */
export class WorkoutBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUUID('4')
  routineId?: string | null;

  @IsOptional()
  @IsUUID('4')
  programId?: string | null;

  @Type(() => Date)
  @IsDate()
  startedAt!: Date;

  /** `null`/omitted = still in progress. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  finishedAt?: Date | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => WorkoutExerciseDto)
  exercises!: WorkoutExerciseDto[];
}

export class CreateWorkoutDto extends WorkoutBodyDto {
  /**
   * Client-generated UUID v4 (offline-first). Retrying the same create returns the existing
   * workout (200) instead of creating a duplicate. Omit to let the server generate one.
   */
  @IsOptional()
  @IsUUID('4')
  id?: string;
}

/**
 * Partial update; `exercises` replaces the whole list. `skipNullProperties: false` keeps `null`
 * from wiping required fields — the nullable ones are re-declared with @IsOptional.
 */
export class UpdateWorkoutDto extends PartialType(WorkoutBodyDto, { skipNullProperties: false }) {
  @IsOptional() @IsUUID('4') declare routineId?: string | null;
  @IsOptional() @IsUUID('4') declare programId?: string | null;
  @IsOptional() @Type(() => Date) @IsDate() declare finishedAt?: Date | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) declare rating?: number | null;
}

export const WORKOUT_STATUS_FILTERS = ['finished', 'in_progress', 'all'] as const;

export class WorkoutListQueryDto extends PaginationQueryDto {
  /** Inclusive lower bound on startedAt (ISO). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Exclusive upper bound on startedAt (ISO). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @IsIn(WORKOUT_STATUS_FILTERS)
  status: (typeof WORKOUT_STATUS_FILTERS)[number] = 'all';

  /** Only sessions started from this routine. */
  @IsOptional()
  @IsUUID('4')
  routineId?: string;

  /** Only sessions that include this exercise (index workouts(userId, exercises.exerciseId, startedAt)). */
  @IsOptional()
  @IsUUID('4')
  exerciseId?: string;
}

// ---------- Responses ----------

export class WorkoutSetResponseDto {
  id!: string;
  @ApiProperty({ enum: SET_TYPES }) type!: SetType;
  @ApiProperty({ type: Number, nullable: true }) weightKg!: number | null;
  @ApiProperty({ type: Number, nullable: true }) reps!: number | null;
  completed!: boolean;
  @ApiProperty({ type: Date, nullable: true }) completedAt!: Date | null;
}

export class WorkoutExerciseResponseDto {
  id!: string;
  exerciseId!: string;
  /** Localized; `null` if the exercise was deleted. */
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) routineExerciseId!: string | null;
  @ApiProperty({ type: String, nullable: true }) groupId!: string | null;
  notes!: string;
  @ApiProperty({ type: [WorkoutSetResponseDto] }) sets!: WorkoutSetResponseDto[];
  volumeKg!: number;
}

export class WorkoutSummaryDto {
  id!: string;
  name!: string;
  @ApiProperty({ type: String, nullable: true }) routineId!: string | null;
  @ApiProperty({ type: String, nullable: true }) programId!: string | null;
  startedAt!: Date;
  @ApiProperty({ type: Date, nullable: true }) finishedAt!: Date | null;
  @ApiProperty({ type: Number, nullable: true }) durationSeconds!: number | null;
  @ApiProperty({ type: Number, nullable: true }) rating!: number | null;
  exerciseCount!: number;
  workingSets!: number;
  volumeKg!: number;
  updatedAt!: Date;
}

export class WorkoutDetailDto extends WorkoutSummaryDto {
  notes!: string;
  @ApiProperty({ type: [WorkoutExerciseResponseDto] }) exercises!: WorkoutExerciseResponseDto[];
  createdAt!: Date;
}

export class BrokenRecordDto {
  exerciseId!: string;
  @ApiProperty({ enum: ['maxWeight', 'bestE1RM', 'maxVolume', 'repsAtWeight'] })
  type!: 'maxWeight' | 'bestE1RM' | 'maxVolume' | 'repsAtWeight';
  /** kg (reps for repsAtWeight). */
  value!: number;
  /** The record it beat. */
  previous!: number;
  weightKg!: number;
  reps!: number;
}

/** Create/update response: the workout plus the records it just broke. */
export class WorkoutSaveResultDto extends WorkoutDetailDto {
  @ApiProperty({ type: [BrokenRecordDto] }) newRecords!: BrokenRecordDto[];
}

export class WorkoutPageDto {
  @ApiProperty({ type: [WorkoutSummaryDto] }) items!: WorkoutSummaryDto[];
  meta!: PageMetaDto;
}

/** One session of one exercise (all its slots in that workout, merged in order). */
export class ExercisePerformanceDto {
  workoutId!: string;
  startedAt!: Date;
  @ApiProperty({ type: [WorkoutSetResponseDto] }) sets!: WorkoutSetResponseDto[];
  volumeKg!: number;
  /** Best Epley e1RM of the session (working sets, 1–12 reps). */
  @ApiProperty({ type: Number, nullable: true }) bestE1RM!: number | null;
}

export class LastPerformanceDto {
  @ApiProperty({ type: ExercisePerformanceDto, nullable: true })
  lastPerformance!: ExercisePerformanceDto | null;
}

export class ExerciseHistoryPageDto {
  @ApiProperty({ type: [ExercisePerformanceDto] }) items!: ExercisePerformanceDto[];
  meta!: PageMetaDto;
}
