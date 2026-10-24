import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const commaSeparatedList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const positiveInt = z.coerce.number().int().positive();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: positiveInt.default(3000),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
    CORS_ORIGINS: commaSeparatedList.default([]),
    THROTTLE_TTL_MS: positiveInt.default(60_000),
    THROTTLE_LIMIT: positiveInt.default(100),
    SWAGGER_ENABLED: booleanString,
    /**
     * Number of reverse proxies in front of the app (Render = 1). Needed so req.ip is the
     * client's IP; otherwise rate limits key on the proxy and throttle everyone together.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** pino level. Default: `info` in production, `debug` in development, `silent` in tests. */
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

    // --- Auth ---
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: positiveInt.default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: positiveInt.default(30),
    EMAIL_VERIFICATION_TTL_HOURS: positiveInt.default(24),
    PASSWORD_RESET_TTL_MINUTES: positiveInt.default(60),
    /** Base URL of the web client; email links point here (e.g. /verify-email?token=…). */
    APP_WEB_URL: z.url().default('http://localhost:4200'),

    // --- Mail ---
    MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: z.string().default('GymApp <no-reply@gymapp.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: positiveInt.default(587),
    SMTP_SECURE: booleanString,
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // --- Media (Cloudinary). All three or none; without them uploads return 503. ---
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    /** Root folder; uploads go to <root>/<NODE_ENV>/... so dev never mixes with prod. */
    CLOUDINARY_FOLDER: z.string().default('gymapp'),
    /** Advisory for clients; enforce the hard cap in a Cloudinary upload preset. */
    MEDIA_MAX_IMAGE_BYTES: positiveInt.default(5 * 1024 * 1024),
    /** Hard cap for rest-alarm sounds, verified by the API after upload (Admin API). */
    MEDIA_MAX_SOUND_BYTES: positiveInt.default(1024 * 1024),
    /** Hard cap for exercise guide images/GIFs, verified by the API after upload (Admin API). */
    MEDIA_MAX_GUIDE_BYTES: positiveInt.default(4 * 1024 * 1024),

    // --- Seed (only read by `npm run seed`) ---
    ADMIN_EMAIL: z.email().optional(),
    ADMIN_PASSWORD: z.string().min(8).optional(),
  })
  .superRefine((env, ctx) => {
    const cloudinary = [
      env.CLOUDINARY_CLOUD_NAME,
      env.CLOUDINARY_API_KEY,
      env.CLOUDINARY_API_SECRET,
    ];
    if (cloudinary.some(Boolean) && !cloudinary.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_CLOUD_NAME'],
        message:
          'set all of CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET or none',
      });
    }
    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'required when MAIL_DRIVER=smtp',
      });
    }
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    LOG_LEVEL:
      env.LOG_LEVEL ??
      ({ production: 'info', development: 'debug', test: 'silent' } as const)[env.NODE_ENV],
    SMTP_SECURE: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
  }));

export type Env = z.output<typeof envSchema>;

/** Used by ConfigModule.validate — fails fast at boot with every invalid variable listed. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
