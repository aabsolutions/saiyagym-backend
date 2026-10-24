import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { DEFAULT_PLANS } from './default-plans';
import type { FeatureKey } from './plan-entitlements';
import { CreatePlanDto, PlanResponseDto, PublicPlanDto, UpdatePlanDto } from './dto/plan.dto';
import { Plan, PlanDocument } from './schemas/plan.schema';

/** Free's seed value (DEFAULT_PLANS), also applied to custom plans saved before the field existed. */
const GUIDES_PER_ROUTINE_FALLBACK = 5;

/** Minimal view of `user.subscription` needed to resolve the effective plan. */
export interface SubscriptionRef {
  planId: string | null;
  status: 'active' | 'canceled' | 'expired';
  currentPeriodEnd: Date | null;
}

@Injectable()
export class PlansService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlansService.name);

  constructor(@InjectModel(Plan.name) private readonly plans: Model<Plan>) {}

  /** Guarantees Free/Premium exist on every boot (fresh DBs, e2e) without touching admin edits. */
  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDefaultPlans();
    // Automatic (not a manual script): until it runs, plans saved before the field existed
    // show no guides at all, and an admin edit in between would persist that 0. One updateMany
    // over a handful of plans; it matches nothing after the first boot.
    const backfilled = await this.backfillGuidesPerRoutine(GUIDES_PER_ROUTINE_FALLBACK, [
      'premium',
    ]);
    if (backfilled) this.logger.log(`Backfilled guidesPerRoutine on ${backfilled} plans`);
  }

  /**
   * Seeds DEFAULT_PLANS only into an empty collection (soft-deleted plans count), so admin
   * edits AND deletions survive restarts. Safe under concurrent boots: upserts on the unique
   * `code` either insert or no-op, and a lost insert race (E11000) is ignored.
   */
  async ensureDefaultPlans(): Promise<void> {
    if ((await this.plans.countDocuments({})) === 0) {
      for (const seed of DEFAULT_PLANS) {
        try {
          await this.plans.updateOne(
            { code: seed.code },
            { $setOnInsert: { _id: randomUUID(), ...seed, active: true, deletedAt: null } },
            { upsert: true },
          );
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
        }
      }
      this.logger.log('Seeded default plans');
    }

    const hasDefault = await this.plans.exists(notDeleted<Plan>({ isDefault: true }));
    if (!hasDefault) {
      // Should be impossible (the default can't be deleted/deactivated); self-heal if it happens.
      const fallback = DEFAULT_PLANS.find((plan) => plan.isDefault)!.code;
      const restored = await this.plans.updateOne(notDeleted<Plan>({ code: fallback }), {
        isDefault: true,
        active: true,
      });
      if (restored.matchedCount) {
        this.logger.warn(`No default plan found; restored "${fallback}" as default`);
      } else {
        this.logger.error('No default plan configured: new sign-ups will fail until one is set');
      }
    }
  }

  /**
   * One-off for features added after plans were created (`npm run db:backfill-premium-sounds`):
   * sets `entitlements.features.<feature>` ONLY where the key is absent — true on the plans whose
   * `code` is in `enabledCodes`, false elsewhere. Idempotent and never overrides an admin edit.
   * Returns how many plans changed.
   */
  async backfillFeature(feature: FeatureKey, enabledCodes: string[]): Promise<number> {
    const path = `entitlements.features.${feature}`;
    const result = await this.plans.collection.updateMany({ [path]: { $exists: false } }, [
      { $set: { [path]: { $in: ['$code', enabledCodes] } } },
    ]);
    return result.modifiedCount;
  }

  /**
   * For `entitlements.guidesPerRoutine` (runs on every boot): sets it ONLY
   * where the key is absent — `null` (unlimited) on the plans whose `code` is in `unlimitedCodes`,
   * `limit` elsewhere. Idempotent and never overrides an admin edit. Returns how many changed.
   */
  async backfillGuidesPerRoutine(limit: number, unlimitedCodes: string[]): Promise<number> {
    const path = 'entitlements.guidesPerRoutine';
    const result = await this.plans.collection.updateMany({ [path]: { $exists: false } }, [
      { $set: { [path]: { $cond: [{ $in: ['$code', unlimitedCodes] }, null, limit] } } },
    ]);
    return result.modifiedCount;
  }

  // --- Queries ---

  async findAllForAdmin(): Promise<PlanDocument[]> {
    return this.plans.find(notDeleted<Plan>()).sort({ sortOrder: 1, createdAt: 1 });
  }

  async findPublicCatalog(): Promise<PlanDocument[]> {
    return this.plans.find(notDeleted<Plan>({ active: true })).sort({ sortOrder: 1 });
  }

  async findById(id: string): Promise<PlanDocument> {
    const plan = await this.plans.findOne(notDeleted<Plan>({ _id: id }));
    if (!plan) throw new AppException(ErrorCode.PLAN_NOT_FOUND, HttpStatus.NOT_FOUND);
    return plan;
  }

  /** A plan an admin can assign right now (exists, not deleted, active). */
  async findAssignable(id: string): Promise<PlanDocument> {
    const plan = await this.findById(id);
    if (!plan.active) throw new AppException(ErrorCode.PLAN_NOT_FOUND, HttpStatus.NOT_FOUND);
    return plan;
  }

  async getDefault(): Promise<PlanDocument> {
    const plan = await this.plans.findOne(notDeleted<Plan>({ isDefault: true }));
    if (!plan) throw new Error('No default plan configured — run `npm run seed`');
    return plan;
  }

  /**
   * The plan whose entitlements apply to a subscription:
   * - `active`: valid until `currentPeriodEnd` (null = no end, e.g. manual assignment).
   * - `canceled`: still valid until `currentPeriodEnd` (paid period runs out).
   * - `expired`, past period, or plan deleted/missing → default plan.
   */
  async resolveEffectivePlan(
    subscription: SubscriptionRef | null | undefined,
  ): Promise<PlanDocument> {
    if (subscription?.planId && subscription.status !== 'expired') {
      const periodOpen =
        subscription.currentPeriodEnd === null
          ? subscription.status === 'active'
          : subscription.currentPeriodEnd.getTime() > Date.now();
      if (periodOpen) {
        const plan = await this.plans.findOne(notDeleted<Plan>({ _id: subscription.planId }));
        if (plan) return plan;
      }
    }
    return this.getDefault();
  }

  // --- Admin mutations ---

  async create(dto: CreatePlanDto): Promise<PlanDocument> {
    try {
      const plan = await this.plans.create({ ...dto, isDefault: false });
      if (dto.isDefault) await this.makeDefault(plan);
      return plan;
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppException(ErrorCode.PLAN_CODE_TAKEN, HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdatePlanDto): Promise<PlanDocument> {
    const plan = await this.findById(id);
    if (plan.isDefault && (dto.isDefault === false || dto.active === false)) {
      // Choose another plan as default first; there must always be one.
      throw new AppException(ErrorCode.PLAN_IS_DEFAULT, HttpStatus.CONFLICT);
    }

    const { isDefault, ...changes } = dto;
    // `entitlements` replaces the whole object; a client that predates `guidesPerRoutine`
    // doesn't send it, and that must not reset it.
    if (changes.entitlements && changes.entitlements.guidesPerRoutine === undefined) {
      changes.entitlements.guidesPerRoutine = plan.entitlements.guidesPerRoutine;
    }
    plan.set(changes);
    await plan.save();
    if (isDefault && !plan.isDefault) await this.makeDefault(plan);
    return plan;
  }

  /** Soft delete. Users on this plan fall back to the default plan automatically. */
  async remove(id: string): Promise<void> {
    const plan = await this.findById(id);
    if (plan.isDefault) throw new AppException(ErrorCode.PLAN_IS_DEFAULT, HttpStatus.CONFLICT);
    // Free the unique code so it can be reused by a new plan.
    plan.set({ deletedAt: new Date(), active: false, code: `${plan.code}__deleted__${plan._id}` });
    await plan.save();
  }

  private async makeDefault(plan: PlanDocument): Promise<void> {
    await this.plans.updateMany({ _id: { $ne: plan._id }, isDefault: true }, { isDefault: false });
    plan.set({ isDefault: true, active: true });
    await plan.save();
  }

  // --- Mappers ---

  toResponse(plan: PlanDocument): PlanResponseDto {
    return {
      id: plan._id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      entitlements: plan.entitlements,
      isDefault: plan.isDefault,
      active: plan.active,
      sortOrder: plan.sortOrder,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  toPublic(plan: PlanDocument, lang: string): PublicPlanDto {
    return {
      id: plan._id,
      code: plan.code,
      name: localize(plan.name, lang),
      description: localize(plan.description, lang),
      entitlements: plan.entitlements,
      isDefault: plan.isDefault,
    };
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}
