import { statsWindow } from './stats-window';

const now = new Date('2024-06-30T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('statsWindow (plan history limit)', () => {
  it('Free (90 days): no `from` → starts exactly 90 days ago, flagged as limited', () => {
    expect(statsWindow(now, 90)).toEqual({ from: daysAgo(90), to: now, limitedByPlan: true });
  });

  it('Free: a `from` older than 90 days is clamped', () => {
    expect(statsWindow(now, 90, daysAgo(365))).toEqual({
      from: daysAgo(90),
      to: now,
      limitedByPlan: true,
    });
  });

  it('Free: a `from` inside the window is respected', () => {
    expect(statsWindow(now, 90, daysAgo(30))).toEqual({
      from: daysAgo(30),
      to: now,
      limitedByPlan: false,
    });
  });

  it('Premium (unlimited): any range, including all history', () => {
    expect(statsWindow(now, null)).toEqual({ from: null, to: now, limitedByPlan: false });
    expect(statsWindow(now, null, daysAgo(3650))).toEqual({
      from: daysAgo(3650),
      to: now,
      limitedByPlan: false,
    });
  });

  it('`to` never goes past now', () => {
    expect(statsWindow(now, null, undefined, new Date('2099-01-01')).to).toEqual(now);
    expect(statsWindow(now, null, undefined, daysAgo(10)).to).toEqual(daysAgo(10));
  });
});
