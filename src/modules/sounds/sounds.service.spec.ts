import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type { Env } from '../../config/env.schema';
import type { EntitlementsService } from '../entitlements/entitlements.service';
import type { MediaService } from '../media/media.service';
import { RestSoundRegistry } from '../users/rest-sound.registry';
import type { RestSound } from './schemas/rest-sound.schema';
import { SoundsService } from './sounds.service';

const lean = <T>(value: T | Promise<T>) => ({ lean: () => Promise.resolve(value) });

describe('SoundsService asset cleanup', () => {
  let current: Partial<RestSound> | null;
  let dbError: Error | null;
  let referencedElsewhere: boolean;
  let destroyed: string[];
  let destroyError: Error | null;
  let service: SoundsService;

  beforeEach(() => {
    current = { _id: 's1', publicId: 'old/P' };
    dbError = null;
    referencedElsewhere = false;
    destroyed = [];
    destroyError = null;

    const failable = <T>(value: T) => (dbError ? Promise.reject(dbError) : Promise.resolve(value));
    const model = {
      findOne: () => lean(current),
      findOneAndUpdate: (_f: unknown, update: Record<string, unknown>) => ({
        lean: () => failable(current && { ...current, ...update }),
      }),
      exists: () => Promise.resolve(referencedElsewhere ? { _id: 'other' } : null),
    };
    const media = {
      verifySoundAsset: () => Promise.resolve({ bytes: 1, durationSec: 1, format: 'mp3' }),
      destroySound: (id: string) =>
        destroyError ? Promise.reject(destroyError) : Promise.resolve(void destroyed.push(id)),
    };
    service = new SoundsService(
      model as unknown as Model<RestSound>,
      {} as EntitlementsService,
      media as unknown as MediaService,
      new RestSoundRegistry(),
      { get: () => undefined } as unknown as ConfigService<Env, true>,
    );
  });

  it('remove destroys the old asset after the write', async () => {
    await service.remove('s1');
    expect(destroyed).toEqual(['old/P']);
  });

  it('remove: DB failure => no destroy attempted', async () => {
    dbError = new Error('write failed');
    await expect(service.remove('s1')).rejects.toThrow('write failed');
    expect(destroyed).toEqual([]);
  });

  it('update: DB failure => no destroy attempted', async () => {
    dbError = new Error('write failed');
    await expect(service.update('s1', { publicId: 'new/Q' })).rejects.toThrow('write failed');
    expect(destroyed).toEqual([]);
  });

  it('update with a new publicId destroys only the old one', async () => {
    await service.update('s1', { publicId: 'new/Q' });
    expect(destroyed).toEqual(['old/P']);
  });

  it('update with the same publicId is a no-op for the asset', async () => {
    await service.update('s1', { publicId: 'old/P' });
    expect(destroyed).toEqual([]);
  });

  it('skips the destroy when another row references the asset', async () => {
    referencedElsewhere = true;
    await service.remove('s1');
    expect(destroyed).toEqual([]);
  });

  it('a failing destroy is swallowed', async () => {
    destroyError = new Error('cloudinary down');
    await expect(service.remove('s1')).resolves.toBeUndefined();
  });
});
