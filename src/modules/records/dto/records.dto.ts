import { ApiProperty } from '@nestjs/swagger';

export class RecordEntryDto {
  /** kg for weight/e1RM/volume records, reps for repsAtWeight. */
  value!: number;
  weightKg!: number;
  reps!: number;
  workoutId!: string;
  achievedAt!: Date;
}

export class RecordsSummaryItemDto {
  exerciseId!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: RecordEntryDto, nullable: true }) maxWeight!: RecordEntryDto | null;
  @ApiProperty({ type: RecordEntryDto, nullable: true }) bestE1RM!: RecordEntryDto | null;
  @ApiProperty({ type: RecordEntryDto, nullable: true }) maxVolume!: RecordEntryDto | null;
}

export class ExerciseRecordsDto {
  exerciseId!: string;
  @ApiProperty({ type: RecordEntryDto, nullable: true }) maxWeight!: RecordEntryDto | null;
  @ApiProperty({ type: RecordEntryDto, nullable: true }) bestE1RM!: RecordEntryDto | null;
  @ApiProperty({ type: RecordEntryDto, nullable: true }) maxVolume!: RecordEntryDto | null;
  /** Most reps at each exact weight, ascending by weight (`value` = reps). */
  @ApiProperty({ type: [RecordEntryDto] }) repsAtWeight!: RecordEntryDto[];
}

export class NewRecordDto {
  exerciseId!: string;
  @ApiProperty({ enum: ['maxWeight', 'bestE1RM', 'maxVolume', 'repsAtWeight'] }) type!: string;
  value!: number;
  /** The record it beat. */
  previous!: number;
  weightKg!: number;
  reps!: number;
}
