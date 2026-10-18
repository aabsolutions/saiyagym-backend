import type { Tier, Tiers } from './exercise.constants';
import { groupByTier, type TierListItem } from './tier-list';

const item = (
  name: string,
  hypertrophy: Tier | null,
  powerlifting: Tier | null,
  personal: Partial<Tiers> = {},
): TierListItem => ({
  name,
  tiers: { hypertrophy, powerlifting },
  personalTiers: { hypertrophy: null, powerlifting: null, ...personal },
});

const names = (list: TierListItem[]) => list.map((i) => i.name);

describe('groupByTier', () => {
  const items = [
    item('Sentadilla trasera', 'S', 'S'),
    item('Curl concentrado', 'B', 'C', { hypertrophy: 'S' }),
    item('Press de banca', 'A', 'S'),
    item('Extensión de cuádriceps', 'A', 'C'),
    item('Mi ejercicio custom', null, null, { hypertrophy: 'A' }),
    item('Face pull', null, 'B'),
  ];

  it('groups by the global tier of the requested goal, in S/A/B/C columns', () => {
    const { tiers, unranked } = groupByTier(items, 'hypertrophy', 'global', 'es');

    expect(Object.keys(tiers)).toEqual(['S', 'A', 'B', 'C']);
    expect(names(tiers.S)).toEqual(['Sentadilla trasera']);
    expect(names(tiers.A)).toEqual(['Extensión de cuádriceps', 'Press de banca']);
    expect(names(tiers.B)).toEqual(['Curl concentrado']);
    expect(tiers.C).toEqual([]);
    expect(names(unranked)).toEqual(['Face pull', 'Mi ejercicio custom']);
  });

  it('uses the other goal’s ranking when asked', () => {
    const { tiers, unranked } = groupByTier(items, 'powerlifting', 'global', 'es');

    expect(names(tiers.S)).toEqual(['Press de banca', 'Sentadilla trasera']);
    expect(names(tiers.B)).toEqual(['Face pull']);
    expect(names(tiers.C)).toEqual(['Curl concentrado', 'Extensión de cuádriceps']);
    expect(names(unranked)).toEqual(['Mi ejercicio custom']);
  });

  it('personal source: the personal tier overrides the global one, global fills the gaps', () => {
    const { tiers, unranked } = groupByTier(items, 'hypertrophy', 'personal', 'es');

    expect(names(tiers.S)).toEqual(['Curl concentrado', 'Sentadilla trasera']);
    expect(names(tiers.A)).toEqual([
      'Extensión de cuádriceps',
      'Mi ejercicio custom',
      'Press de banca',
    ]);
    expect(tiers.B).toEqual([]);
    expect(names(unranked)).toEqual(['Face pull']);
  });

  it('personal source: a personal tier only applies to its own goal', () => {
    // Curl is personal S for hypertrophy only: in powerlifting it keeps its global C.
    const { tiers, unranked } = groupByTier(items, 'powerlifting', 'personal', 'es');

    expect(names(tiers.S)).toEqual(['Press de banca', 'Sentadilla trasera']);
    expect(names(tiers.C)).toEqual(['Curl concentrado', 'Extensión de cuádriceps']);
    expect(names(unranked)).toEqual(['Mi ejercicio custom']);
  });

  it('personal source: each goal can have its own personal tier', () => {
    const both = [item('Curl', 'B', 'C', { hypertrophy: 'A', powerlifting: 'S' })];
    expect(names(groupByTier(both, 'hypertrophy', 'personal', 'es').tiers.A)).toEqual(['Curl']);
    expect(names(groupByTier(both, 'powerlifting', 'personal', 'es').tiers.S)).toEqual(['Curl']);
  });

  it('sorts accent- and case-insensitively within a column', () => {
    const { tiers } = groupByTier(
      [
        item('élévation', 'A', null),
        item('Zancada', 'A', null),
        item('Elevación', 'A', null),
        item('abducción', 'A', null),
      ],
      'hypertrophy',
      'global',
      'es',
    );
    expect(names(tiers.A)).toEqual(['abducción', 'Elevación', 'élévation', 'Zancada']);
  });

  it('returns empty columns for no input', () => {
    const { tiers, unranked } = groupByTier([], 'hypertrophy', 'global', 'en');
    expect(tiers).toEqual({ S: [], A: [], B: [], C: [] });
    expect(unranked).toEqual([]);
  });
});
