import { DEFAULT_PLANS } from './default-plans';
import { FEATURE_KEYS } from './plan-entitlements';

describe('DEFAULT_PLANS', () => {
  const featuresOf = (code: string) =>
    DEFAULT_PLANS.find((plan) => plan.code === code)!.entitlements.features;

  it('seeds premiumSounds on Premium and not on Free', () => {
    expect(featuresOf('premium').premiumSounds).toBe(true);
    expect(featuresOf('free').premiumSounds).toBe(false);
  });

  it('defines every feature key on every plan', () => {
    for (const plan of DEFAULT_PLANS) {
      expect(Object.keys(plan.entitlements.features).sort()).toEqual([...FEATURE_KEYS].sort());
    }
  });
});
