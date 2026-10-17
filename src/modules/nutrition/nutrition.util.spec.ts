import { foodSearchText, macrosFor, mealTotals, normalizeSearch } from './nutrition.util';

describe('nutrition search text', () => {
  it('lowercases, strips accents and collapses spaces', () => {
    expect(normalizeSearch('  Plátano   MADURO ')).toBe('platano maduro');
    expect(normalizeSearch('Piña, jamón y ñoquis')).toBe('pina, jamon y noquis');
  });

  it('joins every translation once', () => {
    expect(foodSearchText({ es: 'Atún', en: 'Tuna' })).toBe('atun tuna');
    expect(foodSearchText({ es: 'Kiwi', en: 'Kiwi' })).toBe('kiwi');
  });
});

describe('meal macros', () => {
  const rice = { kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 };
  const chicken = { kcal: 120, proteinG: 22.5, carbsG: 0, fatG: 2.6 };

  it('scales per-100 g macros to the portion', () => {
    expect(macrosFor(chicken, 150)).toEqual({ kcal: 180, proteinG: 33.8, carbsG: 0, fatG: 3.9 });
  });

  it('sums items from unrounded values', () => {
    const foods = new Map([
      ['rice', rice],
      ['chicken', chicken],
    ]);
    expect(
      mealTotals(
        [
          { foodSlug: 'rice', grams: 250 },
          { foodSlug: 'chicken', grams: 200 },
        ],
        foods,
      ),
    ).toEqual({ kcal: 565, proteinG: 51.8, carbsG: 70.5, fatG: 6 });
  });

  it('skips items whose food no longer exists', () => {
    const foods = new Map([['rice', rice]]);
    expect(
      mealTotals(
        [
          { foodSlug: 'rice', grams: 100 },
          { foodSlug: 'deleted', grams: 500 },
        ],
        foods,
      ),
    ).toEqual({ kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 });
  });
});
