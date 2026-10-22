import { AppException } from '../../common/exceptions/app.exception';
import type { Entitlements } from '../plans/plan-entitlements';
import type { PlansService } from '../plans/plans.service';
import type { UsersService } from '../users/users.service';
import { EntitlementsService } from './entitlements.service';
import { UsageCountersRegistry } from './usage-counters.registry';

const FREE: Entitlements = {
  limits: { routines: 3, activePrograms: 1, customExercises: null },
  statsHistoryDays: 90,
  features: {
    progressPhotos: false,
    autoProgression: false,
    fullStats: false,
    fullNutrition: false,
    dataExport: false,
    premiumSounds: false,
  },
};

describe('EntitlementsService', () => {
  let counters: UsageCountersRegistry;
  let service: EntitlementsService;

  beforeEach(() => {
    counters = new UsageCountersRegistry();
    const users = { requireActiveById: () => Promise.resolve({ subscription: {} }) };
    const plans = { resolveEffectivePlan: () => Promise.resolve({ entitlements: FREE }) };
    service = new EntitlementsService(
      users as unknown as UsersService,
      plans as unknown as PlansService,
      counters,
    );
  });

  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error as AppException,
    );

  it('PLAN_FEATURE_REQUIRED (403) when the plan lacks the feature', async () => {
    const error = await errorOf(service.assertFeature('u1', 'progressPhotos'));
    expect(error?.getStatus()).toBe(403);
    expect(error?.code).toBe('PLAN_FEATURE_REQUIRED');
    expect(error?.details).toEqual({ feature: 'progressPhotos' });
  });

  it('allows creating while under the limit', async () => {
    counters.register('routines', () => Promise.resolve(2));
    await expect(service.assertWithinLimit('u1', 'routines')).resolves.toBeUndefined();
  });

  it('PLAN_LIMIT_REACHED (403) once usage hits the limit', async () => {
    counters.register('routines', () => Promise.resolve(3));
    const error = await errorOf(service.assertWithinLimit('u1', 'routines'));
    expect(error?.getStatus()).toBe(403);
    expect(error?.code).toBe('PLAN_LIMIT_REACHED');
    expect(error?.args).toEqual({ limit: 3 });
    expect(error?.details).toEqual({ resource: 'routines', limit: 3, current: 3, requested: 1 });
  });

  it('checks bulk creation against the remaining room', async () => {
    counters.register('routines', () => Promise.resolve(1));
    await expect(service.assertWithinLimit('u1', 'routines', 2)).resolves.toBeUndefined();
    const error = await errorOf(service.assertWithinLimit('u1', 'routines', 3));
    expect(error?.details).toEqual({ resource: 'routines', limit: 3, current: 1, requested: 3 });
  });

  it('null limit = unlimited (counter not even consulted)', async () => {
    await expect(service.assertWithinLimit('u1', 'customExercises')).resolves.toBeUndefined();
  });

  it('fails closed when a limited resource has no registered counter', async () => {
    await expect(service.assertWithinLimit('u1', 'activePrograms')).rejects.toThrow(
      /No usage counter registered/,
    );
  });
});
