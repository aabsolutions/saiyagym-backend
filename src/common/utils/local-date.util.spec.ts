import {
  addDays,
  daysBetween,
  isValidTimeZone,
  isoWeekdayOf,
  localDateOf,
  weekStartOf,
} from './local-date.util';

describe('local-date utils', () => {
  it('local date depends on the time zone', () => {
    const lateEvening = new Date('2024-03-05T02:30:00Z'); // 23:30 on the 4th in Buenos Aires
    expect(localDateOf(lateEvening, 'UTC')).toBe('2024-03-05');
    expect(localDateOf(lateEvening, 'America/Argentina/Buenos_Aires')).toBe('2024-03-04');
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('Europe/Madrid')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('week start honours the user’s first day of week', () => {
    // 2024-03-06 is a Wednesday.
    expect(isoWeekdayOf('2024-03-06')).toBe(3);
    expect(weekStartOf('2024-03-06', 1)).toBe('2024-03-04'); // Monday
    expect(weekStartOf('2024-03-06', 7)).toBe('2024-03-03'); // Sunday
    expect(weekStartOf('2024-03-04', 1)).toBe('2024-03-04');
  });

  it('day arithmetic crosses months and leap days', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(daysBetween('2024-01-01', '2024-03-01')).toBe(60);
  });
});
