import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { GUIDE_KINDS, type GuideKind } from '../../exercises/exercise.constants';

/** Localized guide file, ready to download and show. */
export class ExerciseGuideDto {
  id!: string;
  @ApiProperty({ enum: GUIDE_KINDS }) kind!: GuideKind;
  url!: string;
  width!: number;
  height!: number;
  /** Localized; '' when the admin wrote none. */
  caption!: string;
}

export class ExerciseGuideSetDto {
  exerciseId!: string;
  @ApiProperty({ type: [ExerciseGuideDto] }) guides!: ExerciseGuideDto[];
}

export class GuidesDto {
  /** The caller's plan value. `null` = every guide is unlocked. */
  @ApiProperty({ type: Number, nullable: true }) guidesPerRoutine!: number | null;
  /** Unlocked exercises with their guides. */
  @ApiProperty({ type: [ExerciseGuideSetDto] }) items!: ExerciseGuideSetDto[];
  /** Exercises that have guides the plan does not unlock (show a lock + upgrade). */
  lockedExerciseIds!: string[];
}

export class ResolveGuidesDto {
  /**
   * Exercises of a session without a routine, in the order they were added. Besides what the
   * routines unlock, the first `guidesPerRoutine` guided ones are unlocked.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  exerciseIds!: string[];
}
