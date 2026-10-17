/**
 * Calendar math on LOCAL dates ("YYYY-MM-DD") in a given IANA time zone. Days and weeks belong
 * to the user's zone: a workout at 23:30 in Buenos Aires is "today" there but "tomorrow" in UTC.
 */

const DAY_MS = 86_400_000;
export const WEEKDAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date of an instant in `tz`. */
export function localDateOf(instant: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function toEpoch(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toEpoch(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toEpoch(to) - toEpoch(from)) / DAY_MS);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekdayOf(date: string): number {
  const day = new Date(toEpoch(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** First day of the week containing `date`, for a week starting on `firstDayOfWeek` (ISO 1–7). */
export function weekStartOf(date: string, firstDayOfWeek: number): string {
  return addDays(date, -((isoWeekdayOf(date) - firstDayOfWeek + 7) % 7));
}
