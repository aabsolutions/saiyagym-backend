import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedRequest } from '../../common/types/authenticated-user';
import type { FeatureKey, LimitKey } from '../plans/plan-entitlements';
import { CHECK_LIMIT_KEY, REQUIRE_FEATURE_KEY } from './entitlements.decorators';
import { EntitlementsService } from './entitlements.service';

/** Global guard (after JWT + roles). No-op unless the route has @RequireFeature / @CheckLimit. */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      REQUIRE_FEATURE_KEY,
      targets,
    );
    const limit = this.reflector.getAllAndOverride<LimitKey | undefined>(CHECK_LIMIT_KEY, targets);
    if (!feature && !limit) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new AppException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);

    if (feature) await this.entitlements.assertFeature(user.id, feature);
    if (limit) await this.entitlements.assertWithinLimit(user.id, limit);
    return true;
  }
}
