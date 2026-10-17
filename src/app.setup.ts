import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { createValidationPipe } from './common/pipes/app-validation.pipe';
import { Env } from './config/env.schema';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'api/docs';

/**
 * Everything that shapes the HTTP surface lives here so main.ts and e2e tests
 * boot the exact same app. (The exception filter and the global guards —
 * throttler, JWT, roles, entitlements — are APP_* providers in AppModule so they get DI.)
 */
export function setupApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.useLogger(app.get(Logger));

  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy > 0) {
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', trustProxy);
  }

  // Express defaults to 100 KB; a sync push of several workouts exceeds it easily (→ 413).
  (app as NestExpressApplication).useBodyParser('json', { limit: '2mb' });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    SwaggerModule.setup(SWAGGER_PATH, app, () => createOpenApiDocument(app), {
      swaggerOptions: { persistAuthorization: true },
    });
  }
}

/** Requires the global prefix to be set first so paths include /api/v1. */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('GymApp API')
    .setDescription(
      'Errors always follow `{ statusCode, code, message, details? }`. ' +
        'Branch on `code`; `message` is localized via `Accept-Language` (es default, en).',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();

  return SwaggerModule.createDocument(app, swaggerConfig);
}
