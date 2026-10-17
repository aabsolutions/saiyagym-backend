import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '../../common/constants/error-codes';
import type { ClientInfo } from '../../common/decorators/client-info.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import type { AccessTokenPayload, AuthenticatedUser } from '../../common/types/authenticated-user';
import type { Env } from '../../config/env.schema';
import { MailTemplatesService } from '../mail/mail-templates.service';
import { MailService } from '../mail/mail.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { ActionTokensService } from './action-tokens.service';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TokenPairDto,
} from './dto/auth.dto';
import { PasswordHasher } from './password-hasher.service';
import { RefreshTokensService } from './refresh-tokens.service';

export interface AuthResult {
  user: UserDocument;
  tokens: TokenPairDto;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly refreshTokens: RefreshTokensService,
    private readonly actionTokens: ActionTokensService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly mailTemplates: MailTemplatesService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // --- Sign up / sign in ---

  async register(dto: RegisterDto, requestLang: string, client: ClientInfo): Promise<AuthResult> {
    if (await this.users.emailExists(dto.email)) throw emailTaken();

    let user: UserDocument;
    try {
      user = await this.users.create({
        email: dto.email,
        passwordHash: await this.hasher.hash(dto.password),
        name: dto.name ?? null,
        language: dto.language ?? requestLang,
      });
    } catch (error) {
      // Lost a race with a concurrent registration of the same email (unique index).
      if ((error as { code?: unknown }).code === 11000) throw emailTaken();
      throw error;
    }

    this.sendInBackground(this.sendVerificationEmail(user));
    return { user, tokens: await this.startSession(user, client) };
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<AuthResult> {
    const user = await this.users.findActiveByEmailWithPassword(dto.email);
    const valid = await this.hasher.verifyOrBurn(user?.passwordHash, dto.password);
    if (!user || !valid) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED);
    }
    return { user, tokens: await this.startSession(user, client) };
  }

  // --- Sessions ---

  /** Rotation: the presented refresh token is consumed and a new pair is returned. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenPairDto> {
    const rotated = await this.refreshTokens.rotate(refreshToken, client);
    const user = await this.users.findActiveById(rotated.userId);
    if (!user) {
      await this.refreshTokens.revokeFamily(rotated.familyId, 'account_deleted');
      throw new AppException(ErrorCode.INVALID_REFRESH_TOKEN, HttpStatus.UNAUTHORIZED);
    }
    // Role is re-read here, so admin role changes propagate on the next refresh.
    return this.buildTokenPair(user, rotated);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens.revokeByToken(refreshToken, 'logout');
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId, 'logout_all');
  }

  // --- Email verification ---

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.actionTokens.consume(token, 'email_verification');
    await this.users.markEmailVerified(userId);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.requireActiveById(userId);
    if (user.emailVerifiedAt) {
      throw new AppException(ErrorCode.EMAIL_ALREADY_VERIFIED, HttpStatus.CONFLICT);
    }
    await this.sendVerificationEmail(user);
  }

  // --- Password recovery ---

  /** Always succeeds from the caller's view: the response never reveals if the email exists. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findActiveByEmail(email);
    if (!user) return;
    // Background send: awaiting SMTP only for existing accounts would leak them via timing.
    this.sendInBackground(this.sendPasswordResetEmail(user));
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.actionTokens.consume(dto.token, 'password_reset');
    await this.users.setPasswordHash(userId, await this.hasher.hash(dto.newPassword));
    // Whoever triggered the reset may be recovering from a compromise: end every session.
    await this.refreshTokens.revokeAllForUser(userId, 'password_changed');
    // Receiving the reset email proves mailbox ownership.
    await this.users.markEmailVerified(userId);
  }

  // --- Account (authenticated) ---

  /** Keeps the caller's current session alive; every other session is revoked. */
  async changePassword(current: AuthenticatedUser, dto: ChangePasswordDto): Promise<void> {
    const user = await this.requireWithValidPassword(current.id, dto.currentPassword);
    await this.users.setPasswordHash(user._id, await this.hasher.hash(dto.newPassword));
    await this.refreshTokens.revokeAllForUser(user._id, 'password_changed', current.sessionId);
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.requireWithValidPassword(userId, password);
    await this.users.anonymize(user._id);
    await this.refreshTokens.revokeAllForUser(user._id, 'account_deleted');
  }

  // --- Internals ---

  private async requireWithValidPassword(userId: string, password: string): Promise<UserDocument> {
    const user = await this.users.findActiveByIdWithPassword(userId);
    if (!user) throw new AppException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw new AppException(ErrorCode.INVALID_CURRENT_PASSWORD, HttpStatus.BAD_REQUEST);
    }
    return user;
  }

  private async startSession(user: UserDocument, client: ClientInfo): Promise<TokenPairDto> {
    const issued = await this.refreshTokens.issue(user._id, client);
    return this.buildTokenPair(user, issued);
  }

  private async buildTokenPair(
    user: UserDocument,
    refresh: { token: string; familyId: string; expiresAt: Date },
  ): Promise<TokenPairDto> {
    const payload: AccessTokenPayload = { sub: user._id, role: user.role, sid: refresh.familyId };
    return {
      accessToken: await this.jwt.signAsync(payload),
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }

  private async sendVerificationEmail(user: UserDocument): Promise<void> {
    const hours = this.config.get('EMAIL_VERIFICATION_TTL_HOURS', { infer: true });
    const token = await this.actionTokens.issue(user._id, 'email_verification', hours * 3_600_000);
    await this.mail.send(
      this.mailTemplates.render({
        template: 'verifyEmail',
        to: user.email,
        lang: user.preferences.language,
        name: user.profile.name,
        actionUrl: this.webUrl('/verify-email', token),
        args: { hours },
      }),
    );
  }

  private async sendPasswordResetEmail(user: UserDocument): Promise<void> {
    const minutes = this.config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true });
    const token = await this.actionTokens.issue(user._id, 'password_reset', minutes * 60_000);
    await this.mail.send(
      this.mailTemplates.render({
        template: 'resetPassword',
        to: user.email,
        lang: user.preferences.language,
        name: user.profile.name,
        actionUrl: this.webUrl('/reset-password', token),
        args: { minutes },
      }),
    );
  }

  /** Relative resolution keeps base paths (GitHub Pages serves under /<repo>/). */
  private webUrl(path: string, token: string): string {
    const base = this.config.get('APP_WEB_URL', { infer: true }).replace(/\/?$/, '/');
    const url = new URL(path.replace(/^\//, ''), base);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private sendInBackground(task: Promise<void>): void {
    task.catch((error: unknown) => this.logger.error('Background email failed', error));
  }
}

function emailTaken(): AppException {
  return new AppException(ErrorCode.EMAIL_ALREADY_REGISTERED, HttpStatus.CONFLICT);
}
