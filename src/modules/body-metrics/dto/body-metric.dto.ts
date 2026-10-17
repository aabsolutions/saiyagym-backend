import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { MEASUREMENT_FIELDS, type MeasurementField } from '../schemas/body-metric.schema';

/** Optional measurement; `null` clears it on PATCH. */
const Measurement = (min: number, max: number) =>
  applyDecorators(IsOptional(), IsNumber({ maxDecimalPlaces: 2 }), Min(min), Max(max));

/** Body of a measurement entry (REST and sync). At least one measurement is required. */
export class BodyMetricBodyDto {
  @Type(() => Date)
  @IsDate()
  measuredAt!: Date;

  @Measurement(20, 400) weightKg?: number | null;
  @Measurement(2, 75) bodyFatPercent?: number | null;
  @Measurement(30, 250) waistCm?: number | null;
  @Measurement(40, 250) chestCm?: number | null;
  @Measurement(40, 250) hipsCm?: number | null;
  @Measurement(10, 80) armCm?: number | null;
  @Measurement(20, 120) thighCm?: number | null;
  @Measurement(15, 80) calfCm?: number | null;
  @Measurement(20, 80) neckCm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateBodyMetricDto extends BodyMetricBodyDto {
  /** Client UUID (offline-first). A retried create returns the stored entry (200). */
  @IsOptional()
  @IsUUID('4')
  id?: string;
}

/** Omitted = unchanged; `null` clears a measurement (at least one must remain). */
export class UpdateBodyMetricDto {
  @IsOptional() @Type(() => Date) @IsDate() measuredAt?: Date;
  @Measurement(20, 400) weightKg?: number | null;
  @Measurement(2, 75) bodyFatPercent?: number | null;
  @Measurement(30, 250) waistCm?: number | null;
  @Measurement(40, 250) chestCm?: number | null;
  @Measurement(40, 250) hipsCm?: number | null;
  @Measurement(10, 80) armCm?: number | null;
  @Measurement(20, 120) thighCm?: number | null;
  @Measurement(15, 80) calfCm?: number | null;
  @Measurement(20, 80) neckCm?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class BodyMetricListQueryDto extends PaginationQueryDto {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class BodyMetricSeriesQueryDto {
  @ApiProperty({ enum: MEASUREMENT_FIELDS })
  @IsIn(MEASUREMENT_FIELDS)
  metric!: MeasurementField;

  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

// ---------- Responses ----------

export class BodyMetricDto {
  id!: string;
  measuredAt!: Date;
  @ApiProperty({ type: Number, nullable: true }) weightKg!: number | null;
  @ApiProperty({ type: Number, nullable: true }) bodyFatPercent!: number | null;
  @ApiProperty({ type: Number, nullable: true }) waistCm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) chestCm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) hipsCm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) armCm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) thighCm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) calfCm!: number | null;
  @ApiProperty({ type: Number, nullable: true }) neckCm!: number | null;
  notes!: string;
  updatedAt!: Date;
}

export class BodyMetricPageDto {
  @ApiProperty({ type: [BodyMetricDto] }) items!: BodyMetricDto[];
  meta!: PageMetaDto;
}

export class SeriesPointDto {
  measuredAt!: Date;
  value!: number;
}

export class BodyMetricSeriesDto {
  @ApiProperty({ enum: MEASUREMENT_FIELDS }) metric!: string;
  @ApiProperty({ type: [SeriesPointDto] }) points!: SeriesPointDto[];
  window!: { from: Date | null; to: Date; limitedByPlan: boolean };
}
