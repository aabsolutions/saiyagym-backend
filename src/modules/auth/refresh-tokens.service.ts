import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import type { ClientInfo } from '../../common/decorators/client-info.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import {
  buildOpaqueToken,
  parseOpaqueToken,
  secretMatches,
} from '../../common/utils/opaque-token.util';
import type { Env } from '../../config/env.schema';
import { RefreshToken, RevokeReason } from './schemas/refresh-token.schema';

export interface IssuedRefreshToken {
  token: string;
  familyId: string;
  expiresAt: Date;
}

export interface RotationResult extends IssuedRefreshToken {
  userId: string;
}

/**
 * Refresh-token rotation with reuse detection (OAuth 2.0 Security BCP §4.14):
 * every refresh consumes the presented token and issues a new one in the same family.
 * If an already-rotated token shows up again, someone holds a stolen copy → the whole
 * family (session) is revoked, logging out both the attacker and the victim.
 */
@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);
  private readonly ttlMs: number;

  constructor(
    @InjectModel(RefreshToken.name) private readonly tokens: Model<RefreshToken>,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  /** Starts a new session (familyId omitted) or continues one (rotation). */
  async issue(userId: string, client: ClientInfo, familyId?: string): Promise<IssuedRefreshToken> {
    const id = randomUUID();
    const { token, hash } = buildOpaqueToken(id);
    const expiresAt = new Date(Date.now() + this.ttlMs);
    const family = familyId ?? randomUUID();

    await this.tokens.create({
      _id: id,
      userId,
      familyId: family,
      tokenHash: hash,
      expiresAt,
      userAgent: client.userAgent,
      ip: client.ip,
    });
    return { token, familyId: family, expiresAt };
  }

  async rotate(presented: string, client: ClientInfo): Promise<RotationResult> {
    const parsed = parseOpaqueToken(presented);
    if (!parsed) throw invalid();

    const record = await this.tokens.findById(parsed.id).select('+tokenHash');
    if (!record || !secretMatches(parsed.secret, record.tokenHash)) throw invalid();

    if (record.revokedAt) {
      if (record.revokedReason === 'rotated')
        await this.handleReuse(record.familyId, record.userId);
      throw record.revokedReason === 'rotated' ? reused() : invalid();
    }
    if (record.expiresAt.getTime() <= Date.now()) throw invalid();

    // Atomic claim: of two concurrent refreshes with the same token, exactly one wins.
    // The loser is indistinguishable from a replay, so it's treated as reuse.
    const claimed = await this.tokens.findOneAndUpdate(
      { _id: record._id, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'rotated' },
    );
    if (!claimed) {
      await this.handleReuse(record.familyId, record.userId);
      throw reused();
    }

    const next = await this.issue(record.userId, client, record.familyId);
    await this.tokens.updateOne(
      { _id: record._id },
      { replacedById: parseOpaqueToken(next.token)!.id },
    );
    return { ...next, userId: record.userId };
  }

  /** Revokes one session. Unknown/invalid tokens are ignored (logout is idempotent). */
  async revokeByToken(presented: string, reason: RevokeReason): Promise<void> {
    const parsed = parseOpaqueToken(presented);
    if (!parsed) return;
    const record = await this.tokens.findById(parsed.id).select('+tokenHash');
    if (!record || !secretMatches(parsed.secret, record.tokenHash)) return;
    await this.revokeFamily(record.familyId, reason);
  }

  async revokeFamily(familyId: string, reason: RevokeReason): Promise<void> {
    await this.tokens.updateMany(
      { familyId, revokedAt: null },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  /** All sessions of a user, optionally keeping the caller's own (`exceptFamilyId`). */
  async revokeAllForUser(
    userId: string,
    reason: RevokeReason,
    exceptFamilyId?: string,
  ): Promise<void> {
    await this.tokens.updateMany(
      {
        userId,
        revokedAt: null,
        ...(exceptFamilyId && { familyId: { $ne: exceptFamilyId } }),
      },
      { revokedAt: new Date(), revokedReason: reason },
    );
  }

  private async handleReuse(familyId: string, userId: string): Promise<void> {
    this.logger.warn(
      `Refresh token reuse detected (user ${userId}, family ${familyId}); revoking session`,
    );
    await this.revokeFamily(familyId, 'reuse_detected');
  }
}

function invalid(): AppException {
  return new AppException(ErrorCode.INVALID_REFRESH_TOKEN, HttpStatus.UNAUTHORIZED);
}

function reused(): AppException {
  return new AppException(ErrorCode.REFRESH_TOKEN_REUSED, HttpStatus.UNAUTHORIZED);
}
