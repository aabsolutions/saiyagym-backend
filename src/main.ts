import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, setupApp, SWAGGER_PATH } from './app.setup';
import { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  // Buffer boot logs until the pino logger is attached in setupApp().
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  setupApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`);
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    logger.log(`Swagger UI on http://localhost:${port}/${SWAGGER_PATH}`);
  }
}

void bootstrap();
