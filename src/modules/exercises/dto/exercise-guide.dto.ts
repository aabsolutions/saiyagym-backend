import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import { GUIDE_KINDS, MAX_GUIDES, type GuideKind } from '../exercise.constants';

export class GuideItemDto {
  /**
   * `public_id` returned by Cloudinary for an `exercise_guide` upload. New ids are verified with
   * the Admin API (folder, format, size); ids already in the exercise keep their metadata.
   */
  @IsString()
  @MaxLength(200)
  publicId!: string;

  @ApiProperty({ type: Object, required: false, example: { es: 'Baja controlado', en: '...' } })
  @IsOptional()
  @IsTranslatable({ maxLength: 200 })
  caption?: Translatable;
}

/** Replaces the whole list; array order = display order. `[]` removes every guide. */
export class ReplaceGuidesDto {
  @IsArray()
  @ArrayMaxSize(MAX_GUIDES)
  @ValidateNested({ each: true })
  @Type(() => GuideItemDto)
  guides!: GuideItemDto[];
}

/** Admin view of a guide: raw caption map + delivery URL for previews. */
export class AdminExerciseGuideDto {
  id!: string;
  @ApiProperty({ enum: GUIDE_KINDS }) kind!: GuideKind;
  publicId!: string;
  format!: string;
  width!: number;
  height!: number;
  bytes!: number;
  @ApiProperty({ type: Object }) caption!: Translatable;
  url!: string;
}
