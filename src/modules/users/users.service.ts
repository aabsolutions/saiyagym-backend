import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { Role } from '../../common/constants/role';
import { PageMetaDto, PaginationQueryDto, skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { escapeRegex } from '../../common/utils/regex.util';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { PlansService } from '../plans/plans.service';
import { AdminUserDto, AdminUserListQueryDto, AssignPlanDto } from './dto/admin-user.dto';
import { MeDto, UpdateMeDto } from './dto/user.dto';
import { RestSoundRegistry } from './rest-sound.registry';
import { User, UserDocument } from './schemas/user.schema';
import { SOUND_PREFERENCE_KEYS } from './sound-preferences';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name?: string | null;
  language?: string;
  role?: Role;
  emailVerifiedAt?: Date | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly plans: PlansService,
    private readonly restSounds: RestSoundRegistry,
  ) {}

  // --- Lookups (soft-deleted users are invisible everywhere) ---

  async findActiveById(id: string): Promise<UserDocument | null> {
    return this.users.findOne(notDeleted<User>({ _id: id }));
  }

  async requireActiveById(id: string): Promise<UserDocument> {
    const user = await this.findActiveById(id);
    if (!user) throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND);
    return user;
  }

  async findActiveByEmail(email: string): Promise<UserDocument | null> {
    return this.users.findOne(notDeleted<User>({ email: normalizeEmail(email) }));
  }

  async findActiveByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.users
      .findOne(notDeleted<User>({ email: normalizeEmail(email) }))
      .select('+passwordHash');
  }

  async findActiveByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.users.findOne(notDeleted<User>({ _id: id })).select('+passwordHash');
  }

  /** Includes soft-deleted users: anonymized emails never collide, so this means "taken". */
  async emailExists(email: string): Promise<boolean> {
    return (await this.users.exists({ email: normalizeEmail(email) })) !== null;
  }

  // --- Mutations ---

  /** Every new user starts on the default (Free) plan. */
  async create(input: CreateUserInput): Promise<UserDocument> {
    const defaultPlan = await this.plans.getDefault();
    return this.users.create({
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      role: input.role ?? Role.USER,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      profile: { name: input.name ?? null },
      preferences: input.language ? { language: input.language } : {},
      subscription: {
        planId: defaultPlan._id,
        status: 'active',
        currentPeriodEnd: null,
        provider: 'manual',
      },
    });
  }

  /** Partial, field-level merge: omitted fields are untouched, `null` clears profile fields. */
  async updateMe(id: string, dto: UpdateMeDto): Promise<UserDocument> {
    const soundIds = new Set<string>();
    for (const key of SOUND_PREFERENCE_KEYS) {
      const value = dto.preferences?.[key];
      if (typeof value === 'string') soundIds.add(value);
    }
    for (const soundId of soundIds) await this.assertSelectableSound(id, soundId);

    const $set: Record<string, unknown> = {};
    for (const [section, values] of Object.entries({
      profile: dto.profile,
      preferences: dto.preferences,
    })) {
      for (const [key, value] of Object.entries(values ?? {})) {
        if (value !== undefined) $set[`${section}.${key}`] = value;
      }
    }

    const user = await this.users.findOneAndUpdate(
      notDeleted<User>({ _id: id }),
      { $set },
      { returnDocument: 'after', runValidators: true },
    );
    if (!user) throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND);
    return user;
  }

  /** The sound must exist (404) and, when premium, the user's plan must allow it (403). */
  private async assertSelectableSound(userId: string, soundId: string): Promise<void> {
    const sound = await this.restSounds.find(soundId);
    if (!sound) throw new AppException(ErrorCode.SOUND_NOT_FOUND, HttpStatus.NOT_FOUND);
    if (sound.access === 'premium') {
      const user = await this.requireActiveById(userId);
      const plan = await this.plans.resolveEffectivePlan(user.subscription);
      if (!plan.entitlements.features.premiumSounds) {
        throw new AppException(ErrorCode.PLAN_FEATURE_REQUIRED, HttpStatus.FORBIDDEN, {
          details: { feature: 'premiumSounds' },
        });
      }
    }
  }

  /** The stored choice, or null when the sound is gone or the plan no longer allows it. */
  private async effectiveSoundId(
    stored: string | null,
    premiumAllowed: boolean,
    cache: Map<string, ReturnType<RestSoundRegistry['find']>>,
  ) {
    if (!stored) return null;
    let lookup = cache.get(stored);
    if (!lookup) {
      lookup = this.restSounds.find(stored);
      cache.set(stored, lookup);
    }
    const sound = await lookup;
    if (!sound) return null;
    return sound.access === 'premium' && !premiumAllowed ? null : stored;
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.users.updateOne(notDeleted<User>({ _id: id, emailVerifiedAt: null }), {
      emailVerifiedAt: new Date(),
    });
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.users.updateOne(notDeleted<User>({ _id: id }), { passwordHash });
  }

  /**
   * Account deletion = soft delete + anonymization (GDPR-style): PII is wiped, the
   * document survives so sync can propagate `deletedAt` and references stay valid.
   */
  async anonymize(id: string): Promise<void> {
    await this.users.updateOne(notDeleted<User>({ _id: id }), {
      $set: {
        deletedAt: new Date(),
        email: `deleted+${id}@deleted.invalid`,
        // Unusable: not a valid argon2 hash, so no password can ever match it.
        passwordHash: `!deleted:${randomBytes(16).toString('hex')}`,
        emailVerifiedAt: null,
        profile: {},
        'subscription.status': 'expired',
      },
    });
  }

  // --- Admin ---

  async listForAdmin(
    query: AdminUserListQueryDto,
  ): Promise<{ items: UserDocument[]; meta: PageMetaDto }> {
    const filter: QueryFilter<User> = notDeleted<User>();
    if (query.role) filter.role = query.role;
    if (query.search) {
      const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
      filter.$or = [{ email: pattern }, { 'profile.name': pattern }];
    }

    const [items, total] = await Promise.all([
      this.users.find(filter).sort({ createdAt: -1 }).skip(skipFor(query)).limit(query.limit),
      this.users.countDocuments(filter),
    ]);
    return { items, meta: pageMeta(query, total) };
  }

  async changeRole(actorId: string, targetId: string, role: Role): Promise<UserDocument> {
    // Prevents an admin from locking the platform out of its last admin by accident.
    if (actorId === targetId) {
      throw new AppException(ErrorCode.CANNOT_CHANGE_OWN_ROLE, HttpStatus.BAD_REQUEST);
    }
    const user = await this.requireActiveById(targetId);
    user.role = role;
    return user.save();
  }

  /** Manual plan assignment (no payment gateway yet; see billing/payment-provider.interface.ts). */
  async assignPlan(targetId: string, dto: AssignPlanDto): Promise<UserDocument> {
    const plan = await this.plans.findAssignable(dto.planId);
    const user = await this.requireActiveById(targetId);
    user.subscription = {
      planId: plan._id,
      status: 'active',
      currentPeriodEnd: dto.currentPeriodEnd ?? null,
      provider: 'manual',
    };
    return user.save();
  }

  // --- Mappers ---

  async toMe(user: UserDocument, lang: string): Promise<MeDto> {
    const plan = await this.plans.resolveEffectivePlan(user.subscription);
    const lookups = new Map<string, ReturnType<RestSoundRegistry['find']>>();
    const premiumAllowed = plan.entitlements.features.premiumSounds;
    return {
      id: user._id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      profile: user.profile,
      preferences: {
        units: user.preferences.units,
        language: user.preferences.language,
        theme: user.preferences.theme,
        defaultRestSeconds: user.preferences.defaultRestSeconds,
        firstDayOfWeek: user.preferences.firstDayOfWeek,
        restSoundId: await this.effectiveSoundId(
          user.preferences.restSoundId ?? null,
          premiumAllowed,
          lookups,
        ),
        trainingReminderSoundId: await this.effectiveSoundId(
          user.preferences.trainingReminderSoundId ?? null,
          premiumAllowed,
          lookups,
        ),
        weighInSoundId: await this.effectiveSoundId(
          user.preferences.weighInSoundId ?? null,
          premiumAllowed,
          lookups,
        ),
      },
      subscription: user.subscription,
      plan: {
        id: plan._id,
        code: plan.code,
        name: localize(plan.name, lang),
        entitlements: plan.entitlements,
      },
      createdAt: user.createdAt,
    };
  }

  toAdmin(user: UserDocument): AdminUserDto {
    return {
      id: user._id,
      email: user.email,
      name: user.profile.name,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      subscription: user.subscription,
      createdAt: user.createdAt,
    };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function pageMeta({ page, limit }: PaginationQueryDto, total: number): PageMetaDto {
  return { page, limit, total };
}
