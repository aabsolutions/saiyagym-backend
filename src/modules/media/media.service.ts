import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { ErrorCode } from '../../common/constants/error-codes';
import { Role } from '../../common/constants/role';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { escapeRegex } from '../../common/utils/regex.util';
import type { Env } from '../../config/env.schema';
import type { UploadPurpose, UploadSignatureDto } from './dto/media.dto';

const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
const MAX_DIMENSION_TRANSFORMATION = 'c_limit,w_1600,h_1600';
const SIGNATURE_TTL_SECONDS = 3600;

/**
 * Where an image is allowed to live: global catalog images, a user's custom-exercise images
 * (public delivery), or a user's progress photos (PRIVATE: `authenticated` delivery type).
 */
export type ImageScope =
  { kind: 'global' } | { kind: 'user'; userId: string } | { kind: 'progress'; userId: string };

const PRIVATE_TYPE = 'authenticated';

interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Signed direct uploads: the client sends the file straight to Cloudinary (no bytes through
 * our API) using a short-lived signature. The server decides `public_id` (folder + random id),
 * formats and max dimensions — the client can't change them without breaking the signature.
 * The API secret never leaves the server.
 *
 * The full path goes into `public_id` (not the `folder` param) so it behaves the same in
 * Cloudinary's fixed and dynamic folder modes, and so `assertValidImageUrl` can check it.
 */
@Injectable()
export class MediaService {
  private readonly credentials: CloudinaryCredentials | null;
  private readonly rootFolder: string;
  private readonly maxFileSizeBytes: number;

  constructor(config: ConfigService<Env, true>) {
    const cloudName = config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const apiKey = config.get('CLOUDINARY_API_KEY', { infer: true });
    const apiSecret = config.get('CLOUDINARY_API_SECRET', { infer: true });
    this.credentials = cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
    // One Cloudinary account for the whole app: configure the SDK once (url/destroy read it).
    if (this.credentials) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }
    this.rootFolder = `${config.get('CLOUDINARY_FOLDER', { infer: true })}/${config.get('NODE_ENV', { infer: true })}`;
    this.maxFileSizeBytes = config.get('MEDIA_MAX_IMAGE_BYTES', { infer: true });
  }

  createUploadSignature(purpose: UploadPurpose, user: AuthenticatedUser): UploadSignatureDto {
    const credentials = this.requireCredentials();
    if (purpose === 'exercise_image' && user.role !== Role.ADMIN) {
      throw new AppException(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
    }

    // Premium for progress photos is checked by the caller (MediaController) — no plan logic here.
    const scope: ImageScope =
      purpose === 'exercise_image'
        ? { kind: 'global' }
        : purpose === 'progress_photo'
          ? { kind: 'progress', userId: user.id }
          : { kind: 'user', userId: user.id };
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
      timestamp,
      public_id: `${this.folderFor(scope)}/${randomUUID()}`,
      allowed_formats: ALLOWED_FORMATS.join(','),
      transformation: MAX_DIMENSION_TRANSFORMATION,
      // Private delivery: the asset is only reachable through URLs signed by our server.
      ...(scope.kind === 'progress' && { type: PRIVATE_TYPE }),
    };

    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${credentials.cloudName}/image/upload`,
      apiKey: credentials.apiKey,
      signature: cloudinary.utils.api_sign_request(params, credentials.apiSecret),
      params,
      maxFileSizeBytes: this.maxFileSizeBytes,
      expiresAt: new Date((timestamp + SIGNATURE_TTL_SECONDS) * 1000),
    };
  }

  /**
   * Only accept image URLs that our signatures could have produced: our cloud, our folder for
   * that scope. Blocks arbitrary URLs (tracking pixels, hotlinking, someone else's uploads).
   */
  assertValidImageUrl(url: string, scope: ImageScope): void {
    const credentials = this.requireCredentials();
    const pattern = new RegExp(
      `^https://res\\.cloudinary\\.com/${escapeRegex(credentials.cloudName)}/image/upload/` +
        `(?:[^/?#]+/)*${escapeRegex(this.folderFor(scope))}/[0-9a-f-]{36}\\.(?:${ALLOWED_FORMATS.join('|')})$`,
    );
    if (!pattern.test(url)) {
      throw new AppException(ErrorCode.INVALID_IMAGE_URL, HttpStatus.BAD_REQUEST);
    }
  }

  /** A progress photo's public id must be one our signature issued for THIS user. */
  assertOwnedPrivateImage(publicId: string, userId: string): void {
    this.requireCredentials();
    const pattern = new RegExp(
      `^${escapeRegex(this.folderFor({ kind: 'progress', userId }))}/[0-9a-f-]{36}$`,
    );
    if (!pattern.test(publicId)) {
      throw new AppException(ErrorCode.INVALID_IMAGE_URL, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Signed delivery URL for a private image, generated per read. Not guessable without the API
   * secret; it doesn't expire (time-limited tokens need Cloudinary's paid "token auth").
   */
  privateImageUrl(publicId: string, format: string): string {
    this.requireCredentials();
    return cloudinary.url(publicId, {
      type: PRIVATE_TYPE,
      sign_url: true,
      secure: true,
      format,
    });
  }

  /** Deletes the asset (and purges CDN caches). "not found" counts as done: deletion is idempotent. */
  async destroyPrivateImage(publicId: string): Promise<void> {
    this.requireCredentials();
    const result = (await cloudinary.uploader.destroy(publicId, {
      type: PRIVATE_TYPE,
      resource_type: 'image',
      invalidate: true,
    })) as { result?: string };
    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new AppException(ErrorCode.MEDIA_DELETE_FAILED, HttpStatus.BAD_GATEWAY, {
        details: { result: result.result },
      });
    }
  }

  private folderFor(scope: ImageScope): string {
    switch (scope.kind) {
      case 'global':
        return `${this.rootFolder}/exercises`;
      case 'user':
        return `${this.rootFolder}/users/${scope.userId}/exercises`;
      case 'progress':
        return `${this.rootFolder}/users/${scope.userId}/progress`;
    }
  }

  private requireCredentials(): CloudinaryCredentials {
    if (!this.credentials) {
      throw new AppException(ErrorCode.MEDIA_NOT_CONFIGURED, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.credentials;
  }
}
