import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const EXPORT_FORMATS = ['csv', 'json'] as const;
export const EXPORT_DATASETS = ['workouts', 'measurements'] as const;

export class ExportQueryDto {
  @ApiProperty({ enum: EXPORT_FORMATS })
  @IsIn(EXPORT_FORMATS)
  format!: (typeof EXPORT_FORMATS)[number];

  /** CSV holds one table: pick which. JSON always includes everything. */
  @ApiProperty({ enum: EXPORT_DATASETS, required: false, default: 'workouts' })
  @IsOptional()
  @IsIn(EXPORT_DATASETS)
  dataset: (typeof EXPORT_DATASETS)[number] = 'workouts';
}
