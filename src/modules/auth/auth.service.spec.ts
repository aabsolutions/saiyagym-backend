import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Connection } from 'mongoose';
import { Role } from '../../common/constants/role';
import type { ClientInfo } from '../../common/decorators/client-info.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import type { AccessTokenPayload } from '../../common/types/authenticated-user';
import type { RenderParams } from '../mail/mail-templates.service';
import { MailTemplatesService } from '../mail/mail-templates.service';
import { MailMessage, MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { ActionTokensService } from './action-tokens.service';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher.service';
import { RefreshTokensService } from './refresh-tokens.service';
import { ActionToken, ActionTokenSchema } from './schemas/action-token.schema';
import { RefreshToken, RefreshTokenSchema } from './schemas/refresh-token.schema';

/** In-memory stand-in for UsersService: AuthService only needs this surface. */
interface FakeUser {
  _id: string;
  email: string;
  passwordHash: string;
  role: Role;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
  profile: { name: string | null };
  preferences: { language: string };
}

class FakeUsers {
  readonly byId = new Map<string, FakeUser>();

  private active(user: FakeUser | undefined) {
    return user && !user.deletedAt ? user : null;
  }
  emailExists(email: string) {
    return Promise.resolve([...this.byId.values()].some((u) => u.email === email));
  }
  create(input: { email: string; passwordHash: string; name?: string | null; language?: string }) {
    const user: FakeUser = {
      _id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      role: Role.USER,
      emailVerifiedAt: null,
      deletedAt: null,
      profile: { name: input.name ?? null },
      preferences: { language: input.language ?? 'es' },
    };
    this.byId.set(user._id, user);
    return Promise.resolve(user);
  }
  findActiveById(id: string) {
    return Promise.resolve(this.active(this.byId.get(id)));
  }
  findActiveByIdWithPassword(id: string) {
    return this.findActiveById(id);
  }
  async requireActiveById(id: string) {
    const user = await this.findActiveById(id);
    if (!user) throw new Error('not found');
    return user;
  }
  findActiveByEmail(email: string) {
    return Promise.resolve(
      this.active([...this.byId.values()].find((u) => u.email === email && !u.deletedAt)),
    );
  }
  findActiveByEmailWithPassword(email: string) {
    return this.findActiveByEmail(email);
  }
  markEmailVerified(id: string) {
    this.byId.get(id)!.emailVerifiedAt ??= new Date();
    return Promise.resolve();
  }
  setPasswordHash(id: string, hash: string) {
    this.byId.get(id)!.passwordHash = hash;
    return Promise.resolve();
  }
  anonymize(id: string) {
    const user = this.byId.get(id)!;
    user.deletedAt = new Date();
    user.email = `deleted+${id}@deleted.invalid`;
    return Promise.resolve();
  }
}

const CONFIG: Record<string, unknown> = {
  JWT_ACCESS_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  EMAIL_VERIFICATION_TTL_HOURS: 24,
  PASSWORD_RESET_TTL_MINUTES: 60,
  APP_WEB_URL: 'https://example.github.io/gymapp-web',
};

const client: ClientInfo = { userAgent: 'jest', ip: '127.0.0.1' };
/** Only for asserting that NOTHING was sent, and for letting stragglers finish before teardown. */
const flushBackgroundTasks = () => new Promise((resolve) => setTimeout(resolve, 100));

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppException);
  await promise.catch((error: AppException) => expect(error.code).toBe(code));
}

describe('AuthService', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let auth: AuthService;
  let jwt: JwtService;
  let users: FakeUsers;
  let sentMail: MailMessage[];

  /**
   * Token from the `nth` email of a given template (`?token=...` in its link).
   * Emails are fire-and-forget (AuthService.sendInBackground): a verification email from
   * register() and a reset email from forgotPassword() may arrive in EITHER order, so we
   * match by template and poll instead of sleeping a fixed time or taking "the last one".
   */
  const emailToken = async (template: RenderParams['template'], nth = 1): Promise<string> => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const matching = sentMail.filter((mail) => mail.subject === template);
      if (matching.length >= nth) {
        return new URL(matching[nth - 1]!.text).searchParams.get('token') ?? '';
      }
      if (Date.now() > deadline) throw new Error(`Expected ${nth} "${template}" email(s)`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    users = new FakeUsers();
    sentMail = [];

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri(`auth-${randomUUID()}`)),
        MongooseModule.forFeature([
          { name: RefreshToken.name, schema: RefreshTokenSchema },
          { name: ActionToken.name, schema: ActionTokenSchema },
        ]),
        JwtModule.register({ secret: 'unit-test-secret', signOptions: { expiresIn: 900 } }),
      ],
      providers: [
        AuthService,
        PasswordHasher,
        RefreshTokensService,
        ActionTokensService,
        { provide: UsersService, useValue: users },
        { provide: ConfigService, useValue: { get: (key: string) => CONFIG[key] } },
        {
          provide: MailService,
          useValue: { send: (m: MailMessage) => Promise.resolve(void sentMail.push(m)) },
        },
        {
          provide: MailTemplatesService,
          // Body = the action URL, so tests can pull the token out of it.
          useValue: {
            render: (p: RenderParams): MailMessage => ({
              to: p.to,
              subject: p.template,
              text: p.actionUrl,
              html: '',
            }),
          },
        },
      ],
    }).compile();
    await moduleRef.init();

    auth = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await flushBackgroundTasks(); // fire-and-forget emails must finish before the DB closes
    await moduleRef.get<Connection>(getConnectionToken()).dropDatabase();
    await moduleRef.close();
    jest.restoreAllMocks();
  });

  const register = (email = 'ana@example.com', password = 'secret-pass-1') =>
    auth.register({ email, password, name: 'Ana' }, 'es', client);

  describe('register', () => {
    it('stores an argon2id hash, returns a session and emails a verification link', async () => {
      const { user, tokens } = await register();
      await emailToken('verifyEmail');

      const stored = users.byId.get(user._id)!;
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain('secret-pass-1');
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresIn).toBe(900);

      expect(sentMail).toHaveLength(1);
      expect(sentMail[0]!.subject).toBe('verifyEmail');
      // Base path of the web app (GitHub Pages /<repo>/) must be preserved.
      expect(sentMail[0]!.text).toMatch(
        /^https:\/\/example\.github\.io\/gymapp-web\/verify-email\?token=/,
      );
    });

    it('rejects an email that is already registered', async () => {
      await register();
      await expectCode(register(), 'EMAIL_ALREADY_REGISTERED');
    });

    it('issues an access token carrying user id, role and session id', async () => {
      const { user, tokens } = await register();
      const payload = await jwt.verifyAsync<AccessTokenPayload>(tokens.accessToken);

      expect(payload).toMatchObject({ sub: user._id, role: Role.USER });
      expect(payload.sid).toEqual(expect.any(String));
    });
  });

  describe('login', () => {
    it('returns a new session for valid credentials', async () => {
      const { user } = await register();
      const { user: loggedIn, tokens } = await auth.login(
        { email: 'ana@example.com', password: 'secret-pass-1' },
        client,
      );
      expect(loggedIn._id).toBe(user._id);
      expect(tokens.refreshToken).toEqual(expect.any(String));
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      await register();
      await expectCode(
        auth.login({ email: 'ana@example.com', password: 'wrong-pass' }, client),
        'INVALID_CREDENTIALS',
      );
      await expectCode(
        auth.login({ email: 'nobody@example.com', password: 'secret-pass-1' }, client),
        'INVALID_CREDENTIALS',
      );
    });
  });

  describe('refresh token rotation', () => {
    it('consumes the presented token and returns a new pair in the same session', async () => {
      const { tokens } = await register();
      const rotated = await auth.refresh(tokens.refreshToken, client);

      expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
      const before = await jwt.verifyAsync<AccessTokenPayload>(tokens.accessToken);
      const after = await jwt.verifyAsync<AccessTokenPayload>(rotated.accessToken);
      expect(after.sid).toBe(before.sid);

      // The new token keeps working (chain of rotations).
      await expect(auth.refresh(rotated.refreshToken, client)).resolves.toBeDefined();
    });

    it('detects reuse of a rotated token and revokes the whole session', async () => {
      const { tokens } = await register();
      const rotated = await auth.refresh(tokens.refreshToken, client);

      // Attacker replays the old token…
      await expectCode(auth.refresh(tokens.refreshToken, client), 'REFRESH_TOKEN_REUSED');
      // …and the legitimate holder's newer token is dead too.
      await expectCode(auth.refresh(rotated.refreshToken, client), 'INVALID_REFRESH_TOKEN');
    });

    it('lets exactly one of two concurrent refreshes with the same token win', async () => {
      const { tokens } = await register();
      const results = await Promise.allSettled([
        auth.refresh(tokens.refreshToken, client),
        auth.refresh(tokens.refreshToken, client),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('does not affect other sessions of the same user', async () => {
      const first = await register();
      const second = await auth.login(
        { email: 'ana@example.com', password: 'secret-pass-1' },
        client,
      );

      await auth.refresh(first.tokens.refreshToken, client);
      await expectCode(auth.refresh(first.tokens.refreshToken, client), 'REFRESH_TOKEN_REUSED');

      await expect(auth.refresh(second.tokens.refreshToken, client)).resolves.toBeDefined();
    });

    it('rejects expired, malformed and tampered tokens', async () => {
      const { tokens } = await register();
      await expectCode(auth.refresh('garbage', client), 'INVALID_REFRESH_TOKEN');
      await expectCode(auth.refresh(`${tokens.refreshToken}x`, client), 'INVALID_REFRESH_TOKEN');

      const thirtyOneDays = 31 * 24 * 60 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + thirtyOneDays);
      await expectCode(auth.refresh(tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
    });

    it('rejects refresh once the account is deleted', async () => {
      const { user, tokens } = await register();
      await users.anonymize(user._id);
      await expectCode(auth.refresh(tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
    });
  });

  describe('logout', () => {
    it('ends that session; its token is then invalid (not flagged as reuse)', async () => {
      const { tokens } = await register();
      await auth.logout(tokens.refreshToken);
      await expectCode(auth.refresh(tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
    });

    it('is idempotent for unknown tokens', async () => {
      await expect(auth.logout('unknown.token-value')).resolves.toBeUndefined();
    });

    it('logout-all ends every session of the user', async () => {
      const a = await register();
      const b = await auth.login({ email: 'ana@example.com', password: 'secret-pass-1' }, client);

      await auth.logoutAll(a.user._id);

      await expectCode(auth.refresh(a.tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
      await expectCode(auth.refresh(b.tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
    });
  });

  describe('change password', () => {
    it('keeps the current session and ends the others', async () => {
      const current = await register();
      const other = await auth.login(
        { email: 'ana@example.com', password: 'secret-pass-1' },
        client,
      );
      const { sid } = await jwt.verifyAsync<AccessTokenPayload>(current.tokens.accessToken);

      await auth.changePassword(
        { id: current.user._id, role: Role.USER, sessionId: sid },
        { currentPassword: 'secret-pass-1', newPassword: 'new-secret-2' },
      );

      await expect(auth.refresh(current.tokens.refreshToken, client)).resolves.toBeDefined();
      await expectCode(auth.refresh(other.tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
      await expect(
        auth.login({ email: 'ana@example.com', password: 'new-secret-2' }, client),
      ).resolves.toBeDefined();
    });

    it('requires the current password', async () => {
      const { user } = await register();
      await expectCode(
        auth.changePassword(
          { id: user._id, role: Role.USER, sessionId: 'x' },
          { currentPassword: 'wrong', newPassword: 'new-secret-2' },
        ),
        'INVALID_CURRENT_PASSWORD',
      );
    });
  });

  describe('email verification', () => {
    it('verifies with a single-use token', async () => {
      const { user } = await register();
      const token = await emailToken('verifyEmail');

      await auth.verifyEmail(token);
      expect(users.byId.get(user._id)!.emailVerifiedAt).toBeInstanceOf(Date);

      await expectCode(auth.verifyEmail(token), 'INVALID_OR_EXPIRED_TOKEN');
    });

    it('invalidates the previous link when a new one is requested', async () => {
      const { user } = await register();
      const first = await emailToken('verifyEmail', 1);

      await auth.resendVerification(user._id);
      await expectCode(auth.verifyEmail(first), 'INVALID_OR_EXPIRED_TOKEN');
      await expect(auth.verifyEmail(await emailToken('verifyEmail', 2))).resolves.toBeUndefined();
    });
  });

  describe('password recovery', () => {
    it('resets with a single-use token and ends every session', async () => {
      const { tokens } = await register();
      await auth.forgotPassword('ana@example.com');
      const token = await emailToken('resetPassword');

      await auth.resetPassword({ token, newPassword: 'brand-new-pass' });

      await expectCode(auth.refresh(tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
      await expectCode(
        auth.login({ email: 'ana@example.com', password: 'secret-pass-1' }, client),
        'INVALID_CREDENTIALS',
      );
      await expect(
        auth.login({ email: 'ana@example.com', password: 'brand-new-pass' }, client),
      ).resolves.toBeDefined();
      await expectCode(
        auth.resetPassword({ token, newPassword: 'another-pass' }),
        'INVALID_OR_EXPIRED_TOKEN',
      );
    });

    it('rejects an expired reset token', async () => {
      await register();
      await auth.forgotPassword('ana@example.com');
      const token = await emailToken('resetPassword');

      // Expiry is enforced by the query (`expiresAt > now`), not only by the TTL index.
      await moduleRef
        .get<Connection>(getConnectionToken())
        .collection('action_tokens')
        .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      await expectCode(
        auth.resetPassword({ token, newPassword: 'brand-new-pass' }),
        'INVALID_OR_EXPIRED_TOKEN',
      );
    });

    it('silently does nothing for unknown emails (no enumeration)', async () => {
      await expect(auth.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
      await flushBackgroundTasks();
      expect(sentMail).toHaveLength(0);
    });
  });

  describe('delete account', () => {
    it('requires the password, anonymizes and ends every session', async () => {
      const { user, tokens } = await register();
      await expectCode(auth.deleteAccount(user._id, 'wrong'), 'INVALID_CURRENT_PASSWORD');

      await auth.deleteAccount(user._id, 'secret-pass-1');

      expect(users.byId.get(user._id)!.deletedAt).toBeInstanceOf(Date);
      await expectCode(auth.refresh(tokens.refreshToken, client), 'INVALID_REFRESH_TOKEN');
      await expectCode(
        auth.login({ email: 'ana@example.com', password: 'secret-pass-1' }, client),
        'INVALID_CREDENTIALS',
      );
    });
  });
});
