import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { I18nLang } from 'nestjs-i18n';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  AuthResponseDto,
  ChangePasswordDto,
  DeleteAccountDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
  TokenPairDto,
} from './dto/auth.dto';

/**
 * Strict per-IP limits on credential endpoints (brute force, credential stuffing,
 * email bombing). They override the global default for these routes only.
 * Behind a proxy (Render) they need TRUST_PROXY, or every user shares one IP.
 */
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const REGISTER_THROTTLE = { default: { limit: 5, ttl: 60 * 60_000 } };
const EMAIL_THROTTLE = { default: { limit: 3, ttl: 15 * 60_000 } };
const TOKEN_THROTTLE = { default: { limit: 10, ttl: 15 * 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Throttle(REGISTER_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Create account (Free plan), send verification email, start a session' })
  async register(
    @Body() dto: RegisterDto,
    @I18nLang() lang: string,
    @Client() client: ClientInfo,
  ): Promise<AuthResponseDto> {
    const { user, tokens } = await this.auth.register(dto, lang, client);
    return { tokens, user: await this.users.toMe(user, lang) };
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @I18nLang() lang: string,
    @Client() client: ClientInfo,
  ): Promise<AuthResponseDto> {
    const { user, tokens } = await this.auth.login(dto, client);
    return { tokens, user: await this.users.toMe(user, lang) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new pair (rotation)',
    description:
      'The presented refresh token becomes invalid. Re-using an already rotated token returns ' +
      '401 REFRESH_TOKEN_REUSED and revokes the whole session.',
  })
  async refresh(@Body() dto: RefreshTokenDto, @Client() client: ClientInfo): Promise<TokenPairDto> {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'End the session of this refresh token. Idempotent; works with an expired access token.',
  })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End every session of the user (all devices)' })
  async logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logoutAll(user.id);
  }

  @Public()
  @Throttle(TOKEN_THROTTLE)
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() dto: TokenDto): Promise<void> {
    await this.auth.verifyEmail(dto.token);
  }

  @ApiBearerAuth()
  @Throttle(EMAIL_THROTTLE)
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.resendVerification(user.id);
  }

  @Public()
  @Throttle(EMAIL_THROTTLE)
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a reset link if the email exists. Always 202 (no user enumeration).',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle(TOKEN_THROTTLE)
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a reset token. Ends every session.' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto);
  }
}

/** Account operations that need the password and touch sessions; same /users/me namespace. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(LOGIN_THROTTLE)
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password. Other sessions are ended; this one stays.' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user, dto);
  }

  @Throttle(LOGIN_THROTTLE)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete account: soft delete + anonymization, all sessions ended' })
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ): Promise<void> {
    await this.auth.deleteAccount(user.id, dto.password);
  }
}
