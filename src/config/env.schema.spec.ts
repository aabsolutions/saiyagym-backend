import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const base = {
    MONGODB_URI: 'mongodb://localhost:27017/test',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('applies defaults and coerces types', () => {
    const env = validateEnv({ ...base, PORT: '4000' });

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      CORS_ORIGINS: [],
      THROTTLE_LIMIT: 100,
      SWAGGER_ENABLED: true,
    });
  });

  it('splits CORS_ORIGINS into a trimmed list', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://a.com, https://b.com ,' });

    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'https://b.com']);
  });

  it('disables Swagger in production unless explicitly enabled', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'production' }).SWAGGER_ENABLED).toBe(false);
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
  });

  it('requires SMTP_HOST only when MAIL_DRIVER=smtp', () => {
    expect(validateEnv(base).MAIL_DRIVER).toBe('console');
    expect(() => validateEnv({ ...base, MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(
      validateEnv({ ...base, MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.x.com', SMTP_PORT: '465' })
        .SMTP_SECURE,
    ).toBe(true);
  });

  it('rejects short JWT secrets', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('fails fast listing invalid variables', () => {
    expect(() => validateEnv({ MONGODB_URI: 'postgres://x', PORT: 'abc' })).toThrow(
      /MONGODB_URI[\s\S]*PORT|PORT[\s\S]*MONGODB_URI/,
    );
  });
});
