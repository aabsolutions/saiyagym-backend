import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import { SLUG_PATTERN } from '../../exercises/dto/exercise-query.dto';
import { SOUND_ACCESS, type SoundAccess } from '../schemas/rest-sound.schema';

export class CreateRestSoundDto {
  @Matches(SLUG_PATTERN)
  @MaxLength(60)
  slug!: string;

  @ApiProperty({ type: Object })
  @IsTranslatable({ maxLength: 80 })
  name!: Translatable;

  @ApiProperty({ enum: SOUND_ACCESS })
  @IsIn(SOUND_ACCESS)
  access!: SoundAccess;

  /** Cloudinary public id returned by a `rest_sound` upload signature. Verified by the API. */
  @IsString()
  @MaxLength(200)
  publicId!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Sending a new `publicId` replaces the audio (it is verified again). */
export class UpdateRestSoundDto extends PartialType(
  OmitType(CreateRestSoundDto, ['slug'] as const),
  { skipNullProperties: false },
) {}

export class AdminRestSoundQueryDto extends PaginationQueryDto {}

// ---------- Responses ----------

export class RestSoundDto {
  id!: string;
  slug!: string;
  name!: string;
  @ApiProperty({ enum: SOUND_ACCESS }) access!: SoundAccess;
  /** True when the sound is premium and the user's plan lacks `premiumSounds`. */
  locked!: boolean;
  durationSec!: number;
  /** iOS delivery (wav). Null while locked. */
  @ApiProperty({ type: String, nullable: true }) wavUrl!: string | null;
  /** Android delivery (mp3). Null while locked. */
  @ApiProperty({ type: String, nullable: true }) mp3Url!: string | null;
}

export class RestSoundListDto {
  @ApiProperty({ type: [RestSoundDto] }) items!: RestSoundDto[];
}

export class AdminRestSoundDto {
  id!: string;
  slug!: string;
  @ApiProperty({ type: Object }) name!: Translatable;
  @ApiProperty({ enum: SOUND_ACCESS }) access!: SoundAccess;
  publicId!: string;
  format!: string;
  durationSec!: number;
  bytes!: number;
  sortOrder!: number;
  @ApiProperty({ type: String, nullable: true }) wavUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) mp3Url!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AdminRestSoundPageDto {
  @ApiProperty({ type: [AdminRestSoundDto] }) items!: AdminRestSoundDto[];
  meta!: PageMetaDto;
}
