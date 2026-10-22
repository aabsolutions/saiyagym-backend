import { RestSoundRegistry } from './rest-sound.registry';

describe('RestSoundRegistry', () => {
  it('fails closed (null) while no lookup is registered', async () => {
    expect(await new RestSoundRegistry().find('any')).toBeNull();
  });

  it('delegates to the registered lookup', async () => {
    const registry = new RestSoundRegistry();
    registry.register((id) => Promise.resolve(id === 'a' ? { access: 'premium' } : null));

    expect(await registry.find('a')).toEqual({ access: 'premium' });
    expect(await registry.find('b')).toBeNull();
  });
});
