import type { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import type { PlansService } from '../plans/plans.service';
import { RestSoundRegistry } from './rest-sound.registry';
import type { User, UserDocument } from './schemas/user.schema';
import { UsersService } from './users.service';

const PREMIUM_SOUND = 'premium-sound';
const FREE_SOUND = 'free-sound';
const DELETED_SOUND = 'deleted-sound';

function userDoc(restSoundId: string | null): UserDocument {
  return {
    _id: 'u1',
    email: 'a@b.c',
    role: 'user',
    emailVerifiedAt: null,
    profile: { name: null },
    preferences: {
      units: 'metric',
      language: 'es',
      theme: 'system',
      defaultRestSeconds: 120,
      firstDayOfWeek: 1,
      restSoundId,
    },
    subscription: {},
    createdAt: new Date(),
  } as unknown as UserDocument;
}

describe('UsersService rest sound preference', () => {
  let stored: UserDocument;
  let premiumSounds: boolean;
  let updates: Record<string, unknown>[];
  let service: UsersService;

  beforeEach(() => {
    stored = userDoc(null);
    premiumSounds = false;
    updates = [];

    const model = {
      findOne: () => Promise.resolve(stored),
      findOneAndUpdate: (_filter: unknown, update: { $set: Record<string, unknown> }) => {
        updates.push(update.$set);
        return Promise.resolve(stored);
      },
    };
    const plans = {
      resolveEffectivePlan: () =>
        Promise.resolve({
          _id: 'p',
          code: 'x',
          name: { es: 'x' },
          entitlements: { features: { premiumSounds } },
        }),
    };
    const registry = new RestSoundRegistry();
    registry.register((id) => {
      if (id === FREE_SOUND) return Promise.resolve({ access: 'free' });
      if (id === PREMIUM_SOUND) return Promise.resolve({ access: 'premium' });
      return Promise.resolve(null); // unknown or soft-deleted
    });
    service = new UsersService(
      model as unknown as Model<User>,
      plans as unknown as PlansService,
      registry,
    );
  });

  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error as AppException,
    );

  describe('updateMe', () => {
    it('stores a free sound', async () => {
      await service.updateMe('u1', { preferences: { restSoundId: FREE_SOUND } });
      expect(updates[0]).toEqual({ 'preferences.restSoundId': FREE_SOUND });
    });

    it('null clears the preference without any lookup', async () => {
      await service.updateMe('u1', { preferences: { restSoundId: null } });
      expect(updates[0]).toEqual({ 'preferences.restSoundId': null });
    });

    it('404 SOUND_NOT_FOUND for an unknown or deleted sound, nothing written', async () => {
      const error = await errorOf(
        service.updateMe('u1', { preferences: { restSoundId: DELETED_SOUND } }),
      );
      expect(error?.getStatus()).toBe(404);
      expect(error?.code).toBe('SOUND_NOT_FOUND');
      expect(updates).toHaveLength(0);
    });

    it('403 PLAN_FEATURE_REQUIRED for a premium sound without premiumSounds, nothing written', async () => {
      const error = await errorOf(
        service.updateMe('u1', { preferences: { restSoundId: PREMIUM_SOUND } }),
      );
      expect(error?.getStatus()).toBe(403);
      expect(error?.code).toBe('PLAN_FEATURE_REQUIRED');
      expect(error?.details).toEqual({ feature: 'premiumSounds' });
      expect(updates).toHaveLength(0);
    });

    it('accepts a premium sound with premiumSounds', async () => {
      premiumSounds = true;
      await service.updateMe('u1', { preferences: { restSoundId: PREMIUM_SOUND } });
      expect(updates[0]).toEqual({ 'preferences.restSoundId': PREMIUM_SOUND });
    });
  });

  describe('toMe (effective restSoundId)', () => {
    it('returns the stored free sound', async () => {
      const me = await service.toMe(userDoc(FREE_SOUND), 'es');
      expect(me.preferences.restSoundId).toBe(FREE_SOUND);
    });

    it('null when the stored sound was deleted', async () => {
      const me = await service.toMe(userDoc(DELETED_SOUND), 'es');
      expect(me.preferences.restSoundId).toBeNull();
    });

    it('null when a stored premium sound is no longer allowed (downgrade)', async () => {
      const me = await service.toMe(userDoc(PREMIUM_SOUND), 'es');
      expect(me.preferences.restSoundId).toBeNull();
    });

    it('returns the premium sound again once the plan allows it (stored value kept)', async () => {
      premiumSounds = true;
      const me = await service.toMe(userDoc(PREMIUM_SOUND), 'es');
      expect(me.preferences.restSoundId).toBe(PREMIUM_SOUND);
    });

    it('null when nothing is stored', async () => {
      const me = await service.toMe(userDoc(null), 'es');
      expect(me.preferences.restSoundId).toBeNull();
    });
  });
});
