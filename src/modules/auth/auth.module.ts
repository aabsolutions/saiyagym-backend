import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import type { Env } from '../../config/env.schema';
import { UsersModule } from '../users/users.module';
import { ActionTokensService } from './action-tokens.service';
import { AccountController, AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher.service';
import { RefreshTokensService } from './refresh-tokens.service';
import { ActionToken, ActionTokenSchema } from './schemas/action-token.schema';
import { RefreshToken, RefreshTokenSchema } from './schemas/refresh-token.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      { name: ActionToken.name, schema: ActionTokenSchema },
    ]),
    // Global: the app-wide JwtAuthGuard (common/guards) verifies tokens with it.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
          algorithm: 'HS256',
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, AccountController],
  providers: [AuthService, PasswordHasher, RefreshTokensService, ActionTokensService],
  exports: [PasswordHasher],
})
export class AuthModule {}
