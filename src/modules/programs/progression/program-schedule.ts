/**
 * Pure calendar math for programs. Dates are LOCAL calendar dates ("YYYY-MM-DD") chosen by the
 * client: "today" depends on the user's timezone, which the server doesn't know — computing it
 * in UTC would show tomorrow's routine to a user in UTC-3 from 21:00 on.
 */

export interface ScheduleDay {
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  routineId: string;
  label: string | null;
}

export interface ScheduleInput {
  startDate: string;
  durationWeeks: number;
  weeks: { days: ScheduleDay[] }[];
  deloadWeeks: number[];
}

export type ScheduleResult =
  | { kind: 'not_started'; startsInDays: number }
  | { kind: 'finished' }
  | { kind: 'rest'; week: number; isDeloadWeek: boolean }
  | { kind: 'training'; week: number; isDeloadWeek: boolean; day: ScheduleDay };

const DAY_MS = 86_400_000;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): boolean {
  if (!LOCAL_DATE.test(value)) return false;
  const parsed = parseLocalDate(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value);
}

/** Calendar date → epoch ms at UTC midnight (only used for day arithmetic, never displayed). */
function parseLocalDate(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

/** ISO weekday of a calendar date (1 = Monday … 7 = Sunday). */
export function isoWeekday(date: string): number {
  const day = new Date(parseLocalDate(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** UTC calendar date; only a fallback when the client doesn't send its local date. */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Week N covers days [7(N-1), 7N) counted from startDate (week 1 = start day + 6 days).
 * Within a week the routine is chosen by weekday.
 */
export function scheduleFor(program: ScheduleInput, date: string): ScheduleResult {
  const elapsedDays = Math.round(
    (parseLocalDate(date) - parseLocalDate(program.startDate)) / DAY_MS,
  );
  if (elapsedDays < 0) return { kind: 'not_started', startsInDays: -elapsedDays };

  const week = Math.floor(elapsedDays / 7) + 1;
  if (week > program.durationWeeks) return { kind: 'finished' };

  const isDeloadWeek = program.deloadWeeks.includes(week);
  const weekday = isoWeekday(date);
  const day = program.weeks[week - 1]?.days.find((d) => d.weekday === weekday);
  return day ? { kind: 'training', week, isDeloadWeek, day } : { kind: 'rest', week, isDeloadWeek };
}
