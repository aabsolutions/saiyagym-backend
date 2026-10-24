import { firstGuided, unlockedByRoutines } from './guide-access';

const guided = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

describe('firstGuided', () => {
  it('takes the first N guided exercises in order', () => {
    expect(firstGuided(['a', 'b', 'c', 'd', 'e', 'f', 'g'], guided, 5)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('skips exercises without guides (they do not use up the quota)', () => {
    expect(firstGuided(['x', 'a', 'y', 'b', 'c'], guided, 2)).toEqual(['a', 'b']);
  });

  it('counts a repeated exercise once', () => {
    expect(firstGuided(['a', 'a', 'b', 'a', 'c'], guided, 3)).toEqual(['a', 'b', 'c']);
  });

  it('null = unlimited; 0 = none', () => {
    expect(firstGuided(['g', 'x', 'a'], guided, null)).toEqual(['g', 'a']);
    expect(firstGuided(['a', 'b'], guided, 0)).toEqual([]);
  });
});

describe('unlockedByRoutines', () => {
  it('unions each routine’s own first N', () => {
    const routines = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ];
    expect([...unlockedByRoutines(routines, guided, 2)].sort()).toEqual(['a', 'b', 'd', 'e']);
  });

  it('null = every guided exercise, even outside routines', () => {
    expect(unlockedByRoutines([], guided, null)).toEqual(guided);
  });

  it('no routines = nothing unlocked', () => {
    expect(unlockedByRoutines([], guided, 5).size).toBe(0);
  });
});
