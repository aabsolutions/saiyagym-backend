import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { Env, validateEnv } from './config/env.schema';
import { loggerConfig } from './config/logger.config';
import { IndexesReadyService } from './database/indexes-ready.service';
import { AuthModule } from './modules/auth/auth.module';
import { EntitlementsGuard } from './modules/entitlements/entitlements.guard';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { HealthModule } from './modules/health/health.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { RoutinesModule } from './modules/routines/routines.module';
import { MailModule } from './modules/mail/mail.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { PlansModule } from './modules/plans/plans.module';
import { UsersModule } from './modules/users/users.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BodyMetricsModule } from './modules/body-metrics/body-metrics.module';
import { SyncModule } from './modules/sync/sync.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { ExportModule } from './modules/export/export.module';
import { ProgressPhotosModule } from './modules/progress-photos/progress-photos.module';
import { RecordsModule } from './modules/records/records.module';
import { StatsModule } from './modules/stats/stats.module';
import { SoundsModule } from './modules/sounds/sounds.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Tests get their env from test/global-setup.ts; a developer's .env must not leak in.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),

    // Structured JSON logs (pino). Nest's own Logger is routed here by setupApp().
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerConfig({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        // Fail a cold start in 10 s (not the 30 s default) when Atlas is unreachable/misconfigured,
        // so Render's health check reports it instead of a hanging boot.
        serverSelectionTimeoutMS: 10_000,
        // One small instance (Render free: 512 MB) against Atlas M0 (500 connections shared by the
        // cluster): the default pool of 100 is never needed.
        maxPoolSize: 10,
      }),
    }),

    // Adding a language = adding src/i18n/<lang>/*.json. No code changes.
    I18nModule.forRoot({
      fallbackLanguage: 'es',
      loaderOptions: { path: join(__dirname, 'i18n'), watch: false },
      resolvers: [new AcceptLanguageResolver({ matchType: 'strict-loose' })],
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
          limit: config.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),

    // Internal domain events (e.g. workout.finished → PRs/stats).
    EventEmitterModule.forRoot(),
    SyncModule,
    MailModule,
    PlansModule,
    UsersModule,
    EntitlementsModule,
    AuthModule,
    ExercisesModule,
    RoutinesModule,
    ProgramsModule,
    WorkoutsModule,
    RecordsModule,
    StatsModule,
    BodyMetricsModule,
    ProgressPhotosModule,
    ExportModule,
    NutritionModule,
    SoundsModule,
    HealthModule,
  ],
  providers: [
    IndexesReadyService,
    // Global guards run in this order.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useExisting: EntitlementsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
