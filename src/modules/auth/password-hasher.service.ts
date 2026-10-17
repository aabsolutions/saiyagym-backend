import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * argon2id with the library defaults (m=64 MiB, t=3, p=4) — above OWASP's minimum.
 * Preferred over bcrypt: memory-hard and no silent 72-byte truncation.
 */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  /**
   * Hash of a random string, verified against when the user doesn't exist (see verifyOrBurn).
   * Started at boot but NOT awaited: an argon2 hash (64 MiB, t=3) takes seconds on Render's free
   * 0.1 CPU and would delay every cold start. The first login of an unknown email awaits it.
   */
  private dummyHash!: Promise<string>;

  onModuleInit(): void {
    this.dummyHash = this.hash(randomBytes(16).toString('hex'));
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed hash (e.g. anonymized account) → never matches.
      return false;
    }
  }

  /**
   * Same cost whether or not the account exists, so login response time doesn't reveal
   * which emails are registered (user enumeration via timing).
   */
  async verifyOrBurn(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      await this.verify(await this.dummyHash, password);
      return false;
    }
    return this.verify(hash, password);
  }
}
