import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import type { Entitlements, FeatureKey, LimitKey } from '../plans/plan-entitlements';
import { PlansService } from '../plans/plans.service';
import { UsersService } from '../users/users.service';
import { UsageCountersRegistry } from './usage-counters.registry';

/**
 * The API is the only authority on what a plan allows (SPEC); clients just hide UI.
 * Use the decorators (@RequireFeature / @CheckLimit) on routes, or call these methods
 * from services for checks that depend on the request body.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly users: UsersService,
    private readonly plans: PlansService,
    private readonly counters: UsageCountersRegistry,
  ) {}

  async getForUser(userId: string): Promise<Entitlements> {
    const user = await this.users.requireActiveById(userId);
    const plan = await this.plans.resolveEffectivePlan(user.subscription);
    return plan.entitlements;
  }

  async hasFeature(userId: string, feature: FeatureKey): Promise<boolean> {
    return (await this.getForUser(userId)).features[feature];
  }

  async assertFeature(userId: string, feature: FeatureKey): Promise<void> {
    if (!(await this.hasFeature(userId, feature))) {
      throw new AppException(ErrorCode.PLAN_FEATURE_REQUIRED, HttpStatus.FORBIDDEN, {
        details: { feature },
      });
    }
  }

  /**
   * Call BEFORE creating `amount` more units of `key` (e.g. copying a template creates several
   * routines at once). Throws when current usage + amount would exceed the limit.
   */
  async assertWithinLimit(userId: string, key: LimitKey, amount = 1): Promise<void> {
    const limit = (await this.getForUser(userId)).limits[key];
    if (limit === null) return;

    const current = await this.counters.count(key, userId);
    if (current + amount > limit) {
      throw new AppException(ErrorCode.PLAN_LIMIT_REACHED, HttpStatus.FORBIDDEN, {
        args: { limit },
        details: { resource: key, limit, current, requested: amount },
      });
    }
  }
}
