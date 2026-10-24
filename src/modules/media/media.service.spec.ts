import type { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { Role } from '../../common/constants/role';
import { AppException } from '../../common/exceptions/app.exception';
import type { Env } from '../../config/env.schema';
import { MediaService } from './media.service';

const SECRET = 'super-secret-api-secret';

function serviceWith(overrides: Partial<Record<keyof Env, unknown>> = {}): MediaService {
  const values: Partial<Record<keyof Env, unknown>> = {
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: '123456',
    CLOUDINARY_API_SECRET: SECRET,
    CLOUDINARY_FOLDER: 'gymapp',
    NODE_ENV: 'test',
    MEDIA_MAX_IMAGE_BYTES: 5_000_000,
    MEDIA_MAX_SOUND_BYTES: 1_048_576,
    MEDIA_MAX_GUIDE_BYTES: 4_194_304,
    ...overrides,
  };
  return new MediaService({ get: (key: keyof Env) => values[key] } as ConfigService<Env, true>);
}

const user = { id: 'user-1', role: Role.USER, sessionId: 's' };
const admin = { id: 'admin-1', role: Role.ADMIN, sessionId: 's' };
const UUID = '3f2b8c1e-5d4a-4b6e-9f10-1234567890ab';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as AppException).code;
  }
};

describe('MediaService', () => {
  it('signs exactly the returned params with the API secret, which is never exposed', () => {
    const result = serviceWith().createUploadSignature('custom_exercise_image', user);

    expect(result.signature).toBe(cloudinary.utils.api_sign_request(result.params, SECRET));
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    expect(result.params.public_id).toMatch(
      /^gymapp\/test\/users\/user-1\/exercises\/[0-9a-f-]{36}$/,
    );
    // Dynamic folder mode places assets by `asset_folder`, not by the public_id path.
    expect(result.params.asset_folder).toBe('gymapp/test/users/user-1/exercises');
    expect(result.params.allowed_formats).toContain('webp');
    expect(result.expiresAt.getTime() - result.params.timestamp * 1000).toBe(3_600_000);
  });

  it('only admins can sign global exercise images', () => {
    expect(codeOf(() => serviceWith().createUploadSignature('exercise_image', user))).toBe(
      'FORBIDDEN',
    );
    const result = serviceWith().createUploadSignature('exercise_image', admin);
    expect(result.params.public_id).toMatch(/^gymapp\/test\/exercises\/[0-9a-f-]{36}$/);
  });

  it('returns MEDIA_NOT_CONFIGURED (503) without credentials', () => {
    const service = serviceWith({ CLOUDINARY_CLOUD_NAME: undefined });
    expect(codeOf(() => service.createUploadSignature('custom_exercise_image', user))).toBe(
      'MEDIA_NOT_CONFIGURED',
    );
  });

  describe('assertValidImageUrl', () => {
    const service = serviceWith();
    const base = 'https://res.cloudinary.com/demo-cloud/image/upload';
    const userScope = { kind: 'user' as const, userId: 'user-1' };

    it('accepts URLs our signatures can produce (with version/transformations)', () => {
      expect(
        codeOf(() =>
          service.assertValidImageUrl(
            `${base}/v1712345678/gymapp/test/users/user-1/exercises/${UUID}.jpg`,
            userScope,
          ),
        ),
      ).toBeUndefined();
      expect(
        codeOf(() =>
          service.assertValidImageUrl(
            `${base}/c_limit,w_1600/v1/gymapp/test/exercises/${UUID}.webp`,
            { kind: 'global' },
          ),
        ),
      ).toBeUndefined();
    });

    it.each([
      ['another user’s folder', `${base}/v1/gymapp/test/users/user-2/exercises/${UUID}.jpg`],
      [
        'another cloud',
        `https://res.cloudinary.com/evil/image/upload/v1/gymapp/test/users/user-1/exercises/${UUID}.jpg`,
      ],
      ['any external URL', 'https://example.com/pixel.gif'],
      ['a non-image format', `${base}/v1/gymapp/test/users/user-1/exercises/${UUID}.svg`],
      [
        'plain http',
        `http://res.cloudinary.com/demo-cloud/image/upload/v1/gymapp/test/users/user-1/exercises/${UUID}.jpg`,
      ],
    ])('rejects %s', (_label, url) => {
      expect(codeOf(() => service.assertValidImageUrl(url, userScope))).toBe('INVALID_IMAGE_URL');
    });
  });

  describe('rest_sound', () => {
    const SOUND_ID = `gymapp/test/sounds/${UUID}`;
    const asset = (overrides: Record<string, unknown> = {}) => ({
      public_id: SOUND_ID,
      bytes: 200_000,
      duration: 12.5,
      is_audio: true,
      format: 'mp3',
      ...overrides,
    });
    let resourceSpy: jest.SpyInstance;
    let destroySpy: jest.SpyInstance;

    beforeEach(() => {
      resourceSpy = jest.spyOn(cloudinary.api, 'resource').mockResolvedValue(asset());
      destroySpy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const errorOf = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => error as AppException,
      );

    it('is admin-only', () => {
      expect(codeOf(() => serviceWith().createUploadSignature('rest_sound', user))).toBe(
        'FORBIDDEN',
      );
    });

    it('signs a video upload into the sounds folder with audio formats only', () => {
      const result = serviceWith().createUploadSignature('rest_sound', admin);

      expect(result.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo-cloud/video/upload');
      expect(result.params.public_id).toMatch(/^gymapp\/test\/sounds\/[0-9a-f-]{36}$/);
      expect(result.params.asset_folder).toBe('gymapp/test/sounds');
      expect(result.params.allowed_formats).toBe('mp3,wav,m4a,ogg,aac');
      expect(result.params.transformation).toBeUndefined();
      expect(result.maxFileSizeBytes).toBe(1_048_576);
      expect(result.signature).toBe(cloudinary.utils.api_sign_request(result.params, SECRET));
    });

    it('verifySoundAsset returns what Cloudinary reports, never client values', async () => {
      const result = await serviceWith().verifySoundAsset(SOUND_ID);

      // Without media_metadata the Admin API omits `duration` (every sound would be rejected).
      expect(resourceSpy).toHaveBeenCalledWith(SOUND_ID, {
        resource_type: 'video',
        media_metadata: true,
      });
      expect(result).toEqual({ bytes: 200_000, durationSec: 12.5, format: 'mp3' });
      expect(destroySpy).not.toHaveBeenCalled();
    });

    it.each([
      ['too big', { bytes: 1_048_577 }, 'size'],
      ['30 s or longer', { duration: 30 }, 'duration'],
      ['without duration', { duration: undefined }, 'duration'],
      ['not audio', { is_audio: false }, 'format'],
    ])('rejects an asset that is %s and destroys it', async (_label, override, reason) => {
      resourceSpy.mockResolvedValue(asset(override));

      const error = await errorOf(serviceWith().verifySoundAsset(SOUND_ID));

      expect(error?.code).toBe('INVALID_SOUND_ASSET');
      expect(error?.details).toEqual({ reason });
      expect(destroySpy).toHaveBeenCalledWith(SOUND_ID, {
        resource_type: 'video',
        invalidate: true,
      });
    });

    it('rejects a public id outside the sounds folder without calling Cloudinary', async () => {
      const error = await errorOf(
        serviceWith().verifySoundAsset(`gymapp/test/users/user-1/exercises/${UUID}`),
      );

      expect(error?.code).toBe('INVALID_SOUND_ASSET');
      expect(error?.details).toEqual({ reason: 'folder' });
      expect(resourceSpy).not.toHaveBeenCalled();
      expect(destroySpy).not.toHaveBeenCalled();
    });

    it('rejects an asset that was never uploaded', async () => {
      resourceSpy.mockRejectedValue({ error: { http_code: 404, message: 'Resource not found' } });

      const error = await errorOf(serviceWith().verifySoundAsset(SOUND_ID));

      expect(error?.code).toBe('INVALID_SOUND_ASSET');
      expect(error?.details).toEqual({ reason: 'not_found' });
    });

    it('destroySound treats "not found" as done and fails on anything else', async () => {
      destroySpy.mockResolvedValueOnce({ result: 'not found' });
      await expect(serviceWith().destroySound(SOUND_ID)).resolves.toBeUndefined();

      destroySpy.mockResolvedValueOnce({ result: 'error' });
      expect((await errorOf(serviceWith().destroySound(SOUND_ID)))?.code).toBe(
        'MEDIA_DELETE_FAILED',
      );
    });
  });

  describe('exercise_guide', () => {
    const GUIDE_ID = `gymapp/test/exercises/guides/${UUID}`;
    const asset = (overrides: Record<string, unknown> = {}) => ({
      public_id: GUIDE_ID,
      bytes: 900_000,
      format: 'gif',
      width: 480,
      height: 360,
      pages: 24,
      ...overrides,
    });
    let resourceSpy: jest.SpyInstance;
    let destroySpy: jest.SpyInstance;

    beforeEach(() => {
      resourceSpy = jest.spyOn(cloudinary.api, 'resource').mockResolvedValue(asset());
      destroySpy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const errorOf = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => error as AppException,
      );

    it('is admin-only', () => {
      expect(codeOf(() => serviceWith().createUploadSignature('exercise_guide', user))).toBe(
        'FORBIDDEN',
      );
    });

    it('signs an image upload into the guides folder, GIF allowed, with the guide size cap', () => {
      const result = serviceWith().createUploadSignature('exercise_guide', admin);
      expect(result.uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
      expect(result.params.public_id).toMatch(/^gymapp\/test\/exercises\/guides\/[0-9a-f-]{36}$/);
      expect(result.params.asset_folder).toBe('gymapp/test/exercises/guides');
      expect(result.params.allowed_formats.split(',')).toContain('gif');
      expect(result.params.transformation).toBe('c_limit,w_1080,h_1080');
      expect(result.maxFileSizeBytes).toBe(4_194_304);
      expect(result.signature).toBe(cloudinary.utils.api_sign_request(result.params, SECRET));
    });

    it('verifyGuideAsset reads kind/format/size from Cloudinary (pages > 1 = animation)', async () => {
      await expect(serviceWith().verifyGuideAsset(GUIDE_ID)).resolves.toEqual({
        kind: 'animation',
        format: 'gif',
        width: 480,
        height: 360,
        bytes: 900_000,
      });
      expect(resourceSpy).toHaveBeenCalledWith(GUIDE_ID, { resource_type: 'image', pages: true });

      resourceSpy.mockResolvedValue(asset({ format: 'png', pages: 1 }));
      expect((await serviceWith().verifyGuideAsset(GUIDE_ID)).kind).toBe('image');
      expect(destroySpy).not.toHaveBeenCalled();
    });

    it.each([
      ['format', { format: 'pdf' }],
      ['size', { bytes: 4_194_305 }],
    ])('destroys and rejects an asset with a bad %s', async (reason, override) => {
      resourceSpy.mockResolvedValue(asset(override));
      const error = await errorOf(serviceWith().verifyGuideAsset(GUIDE_ID));
      expect(error?.code).toBe('INVALID_GUIDE_ASSET');
      expect(error?.details).toEqual({ reason });
      expect(destroySpy).toHaveBeenCalledWith(GUIDE_ID, {
        resource_type: 'image',
        invalidate: true,
      });
    });

    it('rejects a public id outside the guides folder without calling Cloudinary', async () => {
      for (const id of [`gymapp/test/exercises/${UUID}`, `gymapp/test/sounds/${UUID}`]) {
        const error = await errorOf(serviceWith().verifyGuideAsset(id));
        expect(error?.details).toEqual({ reason: 'folder' });
      }
      expect(resourceSpy).not.toHaveBeenCalled();
      expect(destroySpy).not.toHaveBeenCalled();
    });

    it('rejects an asset that was never uploaded', async () => {
      resourceSpy.mockRejectedValue({ error: { http_code: 404, message: 'Resource not found' } });
      const error = await errorOf(serviceWith().verifyGuideAsset(GUIDE_ID));
      expect(error?.details).toEqual({ reason: 'not_found' });
    });

    it('guideUrl delivers the stored format with q_auto', () => {
      expect(serviceWith().guideUrl(GUIDE_ID, 'gif')).toBe(
        `https://res.cloudinary.com/demo-cloud/image/upload/q_auto/${GUIDE_ID}.gif`,
      );
    });
  });
});
