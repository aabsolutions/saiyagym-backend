import { SetMetadata } from '@nestjs/common';
import type { FeatureKey, LimitKey } from '../plans/plan-entitlements';

export const REQUIRE_FEATURE_KEY = 'entitlements:feature';
export const CHECK_LIMIT_KEY = 'entitlements:limit';

/** 403 PLAN_FEATURE_REQUIRED unless the user's effective plan enables `feature`. */
export const RequireFeature = (feature: FeatureKey) => SetMetadata(REQUIRE_FEATURE_KEY, feature);

/**
 * 403 PLAN_LIMIT_REACHED when the user already owns `limit` units of `resource`.
 * Put it on CREATE routes only. Requires a counter registered in UsageCountersRegistry.
 */
export const CheckLimit = (resource: LimitKey) => SetMetadata(CHECK_LIMIT_KEY, resource);
