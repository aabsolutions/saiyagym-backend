import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const UPLOAD_PURPOSES = [
  /** Image of a global exercise. Admin only. */
  'exercise_image',
  /** Image of the caller's own custom exercise. */
  'custom_exercise_image',
  /** Private progress photo (Premium). Uploaded with type=authenticated. */
  'progress_photo',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export class UploadSignatureRequestDto {
  @ApiProperty({ enum: UPLOAD_PURPOSES })
  @IsIn(UPLOAD_PURPOSES)
  purpose!: UploadPurpose;
}

/** Exactly these params (plus `file`, `api_key`, `signature`) must be POSTed to uploadUrl. */
export class SignedUploadParamsDto {
  timestamp!: number;
  public_id!: string;
  allowed_formats!: string;
  /** Incoming transformation: caps dimensions before Cloudinary stores the image. */
  transformation!: string;
  /** Only for progress photos: private delivery. Must be sent as-is (it is signed). */
  @ApiProperty({ required: false, enum: ['authenticated'] }) type?: string;
}

export class UploadSignatureDto {
  /** multipart/form-data POST target. */
  uploadUrl!: string;
  apiKey!: string;
  signature!: string;
  params!: SignedUploadParamsDto;
  /** Client-side check only; the hard cap lives in the Cloudinary upload preset/account. */
  maxFileSizeBytes!: number;
  /** Cloudinary rejects signatures older than 1 hour. */
  expiresAt!: Date;
}
