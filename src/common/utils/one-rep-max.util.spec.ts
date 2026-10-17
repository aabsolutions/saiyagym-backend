import { epley1RM, roundToStep } from './one-rep-max.util';

describe('epley1RM', () => {
  it('applies weight × (1 + reps/30)', () => {
    expect(epley1RM(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley1RM(100, 12)).toBeCloseTo(140, 6);
  });

  it('a single is the max itself', () => {
    expect(epley1RM(200, 1)).toBe(200);
  });

  it.each([
    [100, 0],
    [100, 13],
    [100, 2.5],
    [0, 5],
    [null, 5],
  ])('is null outside the valid domain (%p kg × %p)', (weight, reps) => {
    expect(epley1RM(weight, reps)).toBeNull();
  });
});

describe('roundToStep', () => {
  it('rounds to the nearest plate step without float noise', () => {
    expect(roundToStep(101.2, 2.5)).toBe(100);
    expect(roundToStep(101.3, 2.5)).toBe(102.5);
    expect(roundToStep(70.15, 0.5)).toBe(70);
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it('returns the value unchanged for a non-positive step', () => {
    expect(roundToStep(101.23, 0)).toBe(101.23);
  });
});
