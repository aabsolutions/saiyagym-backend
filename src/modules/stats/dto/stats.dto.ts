import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsTimeZone } from '../../../common/validators/is-time-zone.validator';

export class TimeZoneQueryDto {
  /** IANA zone used to bucket days/weeks (e.g. America/Argentina/Buenos_Aires). Default UTC. */
  @IsOptional()
  @IsTimeZone()
  tz: string = 'UTC';
}

export class RangeQueryDto extends TimeZoneQueryDto {
  /** ISO instant. Free plans are clamped to the last 90 days regardless. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class FrequencyQueryDto extends TimeZoneQueryDto {
  /** Defaults to the current year. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export const TOTAL_METRICS = ['e1rm', 'max_weight'] as const;

export class PowerliftingTotalQueryDto extends RangeQueryDto {
  /** `e1rm` (default): estimated maxes · `max_weight`: heaviest weights actually lifted. */
  @IsOptional()
  @IsIn(TOTAL_METRICS)
  metric: (typeof TOTAL_METRICS)[number] = 'e1rm';
}

// ---------- Responses ----------

export class WindowDto {
  @ApiProperty({ type: Date, nullable: true }) from!: Date | null;
  to!: Date;
  /** Data before `from` exists but your plan doesn't include it. */
  limitedByPlan!: boolean;
}

export class PeriodTotalsDto {
  /** Local date the period starts on. */
  from!: string;
  sessions!: number;
  volumeKg!: number;
  workingSets!: number;
  durationSeconds!: number;
}

export class SummaryDto {
  week!: PeriodTotalsDto;
  month!: PeriodTotalsDto;
  /** Consecutive weeks with ≥ 1 session (the current week doesn't break it until it ends). */
  streakWeeks!: number;
  window!: WindowDto;
}

export class ExerciseStatPointDto {
  /** Local date of the session. */
  date!: string;
  workoutId!: string;
  maxWeightKg!: number;
  @ApiProperty({ type: Number, nullable: true }) bestE1RM!: number | null;
  volumeKg!: number;
}

export class ExerciseStatsDto {
  exerciseId!: string;
  @ApiProperty({ type: [ExerciseStatPointDto] }) points!: ExerciseStatPointDto[];
  window!: WindowDto;
}

export class MuscleVolumeRowDto {
  /** Local date the week starts on (user's first day of week). */
  week!: string;
  muscle!: string;
  /** Completed working sets (primary muscle). */
  sets!: number;
  volumeKg!: number;
}

export class MuscleVolumeDto {
  @ApiProperty({ type: [MuscleVolumeRowDto] }) rows!: MuscleVolumeRowDto[];
  window!: WindowDto;
}

export class HeatmapDayDto {
  date!: string;
  sessions!: number;
  volumeKg!: number;
}

export class WeekFrequencyDto {
  weekStart!: string;
  daysTrained!: number;
}

export class FrequencyDto {
  year!: number;
  @ApiProperty({ type: [WeekFrequencyDto] }) weeks!: WeekFrequencyDto[];
  /** Only days with sessions. */
  @ApiProperty({ type: [HeatmapDayDto] }) heatmap!: HeatmapDayDto[];
  window!: WindowDto;
}

export class TotalPointDto {
  weekStart!: string;
  /** Best so far (running max) per lift; null until the lift has data. */
  @ApiProperty({ type: Number, nullable: true }) squat!: number | null;
  @ApiProperty({ type: Number, nullable: true }) bench!: number | null;
  @ApiProperty({ type: Number, nullable: true }) deadlift!: number | null;
  /** Only once all three lifts have data. */
  @ApiProperty({ type: Number, nullable: true }) total!: number | null;
}

export class PowerliftingTotalDto {
  @ApiProperty({ enum: TOTAL_METRICS }) metric!: string;
  @ApiProperty({ type: [TotalPointDto] }) points!: TotalPointDto[];
  @ApiProperty({ type: Number, nullable: true }) bestTotal!: number | null;
  window!: WindowDto;
}

export class AdherenceWeekDto {
  week!: number;
  planned!: number;
  completed!: number;
}

export class ProgramAdherenceDto {
  programId!: string;
  /** Planned training days from the start up to today (or the end/completion). */
  plannedSessions!: number;
  /** Planned days with a finished workout of this program that day. */
  completedSessions!: number;
  @ApiProperty({ type: Number, nullable: true }) adherencePercent!: number | null;
  /** Finished workouts of this program on unscheduled days. */
  extraSessions!: number;
  @ApiProperty({ type: [AdherenceWeekDto] }) weeks!: AdherenceWeekDto[];
  window!: WindowDto;
}
