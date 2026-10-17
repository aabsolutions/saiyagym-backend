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
});
