import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PHOTO_VIEWS, type PhotoView } from '../schemas/progress-photo.schema';

export const PHOTO_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic'] as const;

export class CreateProgressPhotoDto {
  /** `public_id` from the upload (signature purpose `progress_photo`). */
  @IsString()
  @MaxLength(300)
  publicId!: string;

  @IsIn(PHOTO_FORMATS)
  format!: string;

  /** `secure_url` returned by Cloudinary. */
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(600)
  url!: string;

  @ApiProperty({ enum: PHOTO_VIEWS })
  @IsIn(PHOTO_VIEWS)
  view!: PhotoView;

  @Type(() => Date)
  @IsDate()
  takenAt!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ProgressPhotoListQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: PHOTO_VIEWS, required: false })
  @IsOptional()
  @IsIn(PHOTO_VIEWS)
  view?: PhotoView;

  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class CompareQueryDto {
  @ApiProperty({ enum: PHOTO_VIEWS })
  @IsIn(PHOTO_VIEWS)
  view!: PhotoView;

  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class ProgressPhotoDto {
  id!: string;
  @ApiProperty({ enum: PHOTO_VIEWS }) view!: PhotoView;
  takenAt!: Date;
  /** Signed delivery URL generated for this response (the asset is private). */
  url!: string;
  publicId!: string;
  notes!: string;
}

export class ProgressPhotoPageDto {
  @ApiProperty({ type: [ProgressPhotoDto] }) items!: ProgressPhotoDto[];
  meta!: PageMetaDto;
}

export class CompareDto {
  @ApiProperty({ enum: PHOTO_VIEWS }) view!: PhotoView;
  /** Earliest photo in range. */
  @ApiProperty({ type: ProgressPhotoDto, nullable: true }) before!: ProgressPhotoDto | null;
  /** Latest photo in range (null if there's only one). */
  @ApiProperty({ type: ProgressPhotoDto, nullable: true }) after!: ProgressPhotoDto | null;
}
