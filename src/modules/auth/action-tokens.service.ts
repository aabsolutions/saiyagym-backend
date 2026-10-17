import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import {
  buildOpaqueToken,
  parseOpaqueToken,
  secretMatches,
} from '../../common/utils/opaque-token.util';
import { ActionToken, ActionTokenPurpose } from './schemas/action-token.schema';

/** Single-use, expiring tokens for email verification and password reset. */
@Injectable()
export class ActionTokensService {
  constructor(@InjectModel(ActionToken.name) private readonly tokens: Model<ActionToken>) {}

  /** Issuing a new token invalidates any previous unused one of the same purpose. */
  async issue(userId: string, purpose: ActionTokenPurpose, ttlMs: number): Promise<string> {
    await this.tokens.updateMany({ userId, purpose, usedAt: null }, { usedAt: new Date() });

    const id = randomUUID();
    const { token, hash } = buildOpaqueToken(id);
    await this.tokens.create({
      _id: id,
      userId,
      purpose,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  /** Atomically marks the token as used and returns its owner. Any failure → same generic error. */
  async consume(presented: string, purpose: ActionTokenPurpose): Promise<string> {
    const parsed = parseOpaqueToken(presented);
    if (!parsed) throw invalidOrExpired();

    const record = await this.tokens.findById(parsed.id).select('+tokenHash');
    if (!record || record.purpose !== purpose || !secretMatches(parsed.secret, record.tokenHash)) {
      throw invalidOrExpired();
    }

    const claimed = await this.tokens.findOneAndUpdate(
      { _id: record._id, usedAt: null, expiresAt: { $gt: new Date() } },
      { usedAt: new Date() },
    );
    if (!claimed) throw invalidOrExpired();
    return claimed.userId;
  }
}

function invalidOrExpired(): AppException {
  return new AppException(ErrorCode.INVALID_OR_EXPIRED_TOKEN, HttpStatus.BAD_REQUEST);
}
