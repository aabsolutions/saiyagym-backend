import { ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength } from 'class-validator';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import { SLUG_PATTERN } from './exercise-query.dto';

export class CreateExerciseTagDto {
  /** Immutable, e.g. `lumbar-friendly`. */
  @Matches(SLUG_PATTERN)
  @MaxLength(40)
  slug!: string;

  @ApiProperty({ type: Object, example: { es: 'Amigable lumbar', en: 'Lower-back friendly' } })
  @IsTranslatable({ maxLength: 40 })
  name!: Translatable;
}

export class UpdateExerciseTagDto {
  @ApiProperty({ type: Object })
  @IsTranslatable({ maxLength: 40 })
  name!: Translatable;
}

export class ExerciseTagDto {
  slug!: string;
  name!: string;
}

export class AdminExerciseTagDto {
  id!: string;
  slug!: string;
  @ApiProperty({ type: Object }) name!: Translatable;
}
