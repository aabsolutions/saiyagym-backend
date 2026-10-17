import { localize } from './translatable.util';

describe('localize', () => {
  const text = { es: 'Sentadilla', en: 'Squat' };

  it('returns the requested language, including regional variants', () => {
    expect(localize(text, 'en')).toBe('Squat');
    expect(localize(text, 'en-US')).toBe('Squat');
  });

  it('falls back to es, then to any value, then to empty', () => {
    expect(localize(text, 'fr')).toBe('Sentadilla');
    expect(localize({ en: 'Only English' }, 'fr')).toBe('Only English');
    expect(localize({ es: '', en: 'X' }, 'es')).toBe('X');
    expect(localize({}, 'es')).toBe('');
    expect(localize(undefined, 'es')).toBe('');
  });
});
