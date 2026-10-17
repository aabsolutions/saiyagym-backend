import { isLocalDate, isoWeekday, scheduleFor, type ScheduleInput } from './program-schedule';

// 2024-01-01 is a Monday.
const program: ScheduleInput = {
  startDate: '2024-01-01',
  durationWeeks: 2,
  deloadWeeks: [2],
  weeks: [
    {
      days: [
        { weekday: 1, routineId: 'A', label: 'Upper' },
        { weekday: 4, routineId: 'B', label: 'Lower' },
      ],
    },
    { days: [{ weekday: 2, routineId: 'C', label: null }] },
  ],
};

describe('program schedule', () => {
  it('computes ISO weekdays', () => {
    expect(isoWeekday('2024-01-01')).toBe(1);
    expect(isoWeekday('2024-01-07')).toBe(7);
  });

  it('validates calendar dates', () => {
    expect(isLocalDate('2024-02-29')).toBe(true);
    expect(isLocalDate('2023-02-29')).toBe(false);
    expect(isLocalDate('2024-1-1')).toBe(false);
  });

  it('before the start date', () => {
    expect(scheduleFor(program, '2023-12-30')).toEqual({ kind: 'not_started', startsInDays: 2 });
  });

  it('training day in week 1, by weekday', () => {
    expect(scheduleFor(program, '2024-01-04')).toEqual({
      kind: 'training',
      week: 1,
      isDeloadWeek: false,
      day: { weekday: 4, routineId: 'B', label: 'Lower' },
    });
  });

  it('rest day when no routine is scheduled for that weekday', () => {
    expect(scheduleFor(program, '2024-01-03')).toEqual({
      kind: 'rest',
      week: 1,
      isDeloadWeek: false,
    });
  });

  it('week 2 uses its own days and flags the deload week', () => {
    expect(scheduleFor(program, '2024-01-09')).toMatchObject({
      kind: 'training',
      week: 2,
      isDeloadWeek: true,
      day: { routineId: 'C' },
    });
    expect(scheduleFor(program, '2024-01-08')).toEqual({
      kind: 'rest',
      week: 2,
      isDeloadWeek: true,
    });
  });

  it('weeks count from the start date, whatever weekday it is', () => {
    const midweek = { ...program, startDate: '2024-01-03' }; // Wednesday
    expect(scheduleFor(midweek, '2024-01-09')).toMatchObject({ week: 1 }); // day 6
    expect(scheduleFor(midweek, '2024-01-10')).toMatchObject({ week: 2 }); // day 7
  });

  it('finished after the last week', () => {
    expect(scheduleFor(program, '2024-01-15')).toEqual({ kind: 'finished' });
  });
});
