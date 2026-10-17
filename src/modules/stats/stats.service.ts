import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { WORKING_SET_TYPES } from '../../common/constants/training';
import { AppException } from '../../common/exceptions/app.exception';
import {
  addDays,
  isoWeekdayOf,
  localDateOf,
  WEEKDAY_NAMES,
  weekStartOf,
} from '../../common/utils/local-date.util';
import { notDeleted } from '../../database/base.schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { ExercisesService } from '../exercises/exercises.service';
import { Program } from '../programs/schemas/program.schema';
import { UsersService } from '../users/users.service';
import { Workout } from '../workouts/schemas/workout.schema';
import {
  ExerciseStatsDto,
  FrequencyDto,
  MuscleVolumeDto,
  PowerliftingTotalDto,
  ProgramAdherenceDto,
  SummaryDto,
} from './dto/stats.dto';
import { statsWindow, type StatsWindow } from './stats-window';

/** Competition lifts and the variants that count toward each (global exercise slugs). */
export const POWERLIFTING_LIFTS = {
  squat: ['barbell-back-squat', 'low-bar-squat'],
  bench: ['barbell-bench-press', 'paused-bench-press'],
  deadlift: ['conventional-deadlift', 'sumo-deadlift'],
} as const;
type Lift = keyof typeof POWERLIFTING_LIFTS;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

interface UserContext {
  window: StatsWindow;
  firstDayOfWeek: number;
}

interface DayBucket {
  _id: string;
  sessions: number;
  volumeKg: number;
  workingSets: number;
  durationSeconds: number;
}

/** Completed working sets with load and reps — what counts for stats (SPEC: no warmups). */
const COUNTED_SET = {
  'exercises.sets.completed': true,
  'exercises.sets.type': { $in: [...WORKING_SET_TYPES] },
};

/** Epley in the pipeline: weight × (1 + reps/30), only 1–12 reps (SPEC); 1 rep = the weight. */
const E1RM_EXPR = {
  $cond: [
    { $and: [{ $gte: ['$r', 1] }, { $lte: ['$r', 12] }] },
    {
      $cond: [
        { $eq: ['$r', 1] },
        '$w',
        { $multiply: ['$w', { $add: [1, { $divide: ['$r', 30] }] }] },
      ],
    },
    null,
  ],
};

@Injectable()
export class StatsService {
  constructor(
    @InjectModel(Workout.name) private readonly workouts: Model<Workout>,
    @InjectModel(Program.name) private readonly programs: Model<Program>,
    private readonly users: UsersService,
    private readonly entitlements: EntitlementsService,
    private readonly exercises: ExercisesService,
  ) {}

  // ===== /stats/summary =====

  async summary(userId: string, tz: string): Promise<SummaryDto> {
    const { window, firstDayOfWeek } = await this.context(userId);
    const days = await this.dailyBuckets(userId, window, tz);

    const today = localDateOf(new Date(), tz);
    const weekStart = weekStartOf(today, firstDayOfWeek);
    const monthStart = `${today.slice(0, 8)}01`;
    const totals = (from: string) => {
      const inPeriod = days.filter((d) => d._id >= from && d._id <= today);
      return {
        from,
        sessions: inPeriod.reduce((n, d) => n + d.sessions, 0),
        volumeKg: r2(inPeriod.reduce((n, d) => n + d.volumeKg, 0)),
        workingSets: inPeriod.reduce((n, d) => n + d.workingSets, 0),
        durationSeconds: inPeriod.reduce((n, d) => n + d.durationSeconds, 0),
      };
    };

    // Weekly streak: the current week only extends it (an empty current week doesn't break it yet).
    const trainedWeeks = new Set(days.map((d) => weekStartOf(d._id, firstDayOfWeek)));
    let cursor = trainedWeeks.has(weekStart) ? weekStart : addDays(weekStart, -7);
    let streakWeeks = 0;
    while (trainedWeeks.has(cursor)) {
      streakWeeks++;
      cursor = addDays(cursor, -7);
    }

    return { week: totals(weekStart), month: totals(monthStart), streakWeeks, window };
  }

  // ===== /stats/exercise/:id =====

  async exercise(
    userId: string,
    exerciseId: string,
    tz: string,
    from?: Date,
    to?: Date,
  ): Promise<ExerciseStatsDto> {
    const { window } = await this.context(userId, from, to);
    const rows = await this.workouts.aggregate<{
      _id: string;
      startedAt: Date;
      maxWeightKg: number;
      bestE1RM: number | null;
      volumeKg: number;
    }>([
      { $match: { ...this.finishedIn(userId, window), 'exercises.exerciseId': exerciseId } },
      { $unwind: '$exercises' },
      { $match: { 'exercises.exerciseId': exerciseId } },
      ...this.loadedSets(),
      {
        $group: {
          _id: '$_id',
          startedAt: { $first: '$startedAt' },
          maxWeightKg: { $max: '$w' },
          bestE1RM: { $max: E1RM_EXPR },
          volumeKg: { $sum: { $multiply: ['$w', '$r'] } },
        },
      },
      { $sort: { startedAt: 1, _id: 1 } },
    ]);
    return {
      exerciseId,
      points: rows.map((row) => ({
        date: localDateOf(row.startedAt, tz),
        workoutId: row._id,
        maxWeightKg: row.maxWeightKg,
        bestE1RM: row.bestE1RM === null ? null : r1(row.bestE1RM),
        volumeKg: r2(row.volumeKg),
      })),
      window,
    };
  }

  // ===== /stats/muscle-volume =====

  async muscleVolume(userId: string, tz: string, from?: Date, to?: Date): Promise<MuscleVolumeDto> {
    const { window, firstDayOfWeek } = await this.context(userId, from, to);
    const rows = await this.workouts.aggregate<{
      _id: { week: string; muscle: string };
      sets: number;
      volumeKg: number;
    }>([
      { $match: this.finishedIn(userId, window) },
      { $unwind: '$exercises' },
      { $unwind: '$exercises.sets' },
      { $match: COUNTED_SET },
      {
        $lookup: {
          from: 'exercises',
          localField: 'exercises.exerciseId',
          foreignField: '_id',
          as: 'exercise',
          pipeline: [{ $project: { primaryMuscle: 1 } }],
        },
      },
      { $unwind: '$exercise' },
      {
        $group: {
          _id: {
            week: {
              $dateToString: {
                format: '%Y-%m-%d',
                timezone: tz,
                date: {
                  $dateTrunc: {
                    date: '$startedAt',
                    unit: 'week',
                    timezone: tz,
                    startOfWeek: WEEKDAY_NAMES[firstDayOfWeek - 1],
                  },
                },
              },
            },
            muscle: '$exercise.primaryMuscle',
          },
          sets: { $sum: 1 },
          volumeKg: {
            $sum: {
              $multiply: [
                { $ifNull: ['$exercises.sets.weightKg', 0] },
                { $ifNull: ['$exercises.sets.reps', 0] },
              ],
            },
          },
        },
      },
      { $sort: { '_id.week': 1, '_id.muscle': 1 } },
    ]);
    return {
      rows: rows.map((row) => ({
        week: row._id.week,
        muscle: row._id.muscle,
        sets: row.sets,
        volumeKg: r2(row.volumeKg),
      })),
      window,
    };
  }

  // ===== /stats/frequency =====

  async frequency(userId: string, tz: string, year?: number): Promise<FrequencyDto> {
    const targetYear = year ?? Number(localDateOf(new Date(), tz).slice(0, 4));
    // Instants padded by a day each side: local years don't align with UTC midnight.
    const { window, firstDayOfWeek } = await this.context(
      userId,
      new Date(Date.UTC(targetYear, 0, 1) - 86_400_000),
      new Date(Date.UTC(targetYear + 1, 0, 1) + 86_400_000),
    );
    const days = (await this.dailyBuckets(userId, window, tz)).filter((d) =>
      d._id.startsWith(`${targetYear}-`),
    );

    const perWeek = new Map<string, number>();
    for (const day of days) {
      const week = weekStartOf(day._id, firstDayOfWeek);
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    return {
      year: targetYear,
      weeks: [...perWeek.entries()]
        .sort()
        .map(([weekStart, daysTrained]) => ({ weekStart, daysTrained })),
      heatmap: days.map((d) => ({ date: d._id, sessions: d.sessions, volumeKg: r2(d.volumeKg) })),
      window,
    };
  }

  // ===== /stats/powerlifting-total =====

  async powerliftingTotal(
    userId: string,
    tz: string,
    metric: 'e1rm' | 'max_weight',
    from?: Date,
    to?: Date,
  ): Promise<PowerliftingTotalDto> {
    const { window, firstDayOfWeek } = await this.context(userId, from, to);
    const catalog = await this.exercises.findGlobalBySlugs(
      Object.values(POWERLIFTING_LIFTS).flat(),
    );
    const liftOf = new Map<string, Lift>();
    for (const [lift, slugs] of Object.entries(POWERLIFTING_LIFTS) as [Lift, readonly string[]][]) {
      for (const slug of slugs) if (catalog.has(slug)) liftOf.set(catalog.get(slug)!._id, lift);
    }
    const ids = [...liftOf.keys()];

    const rows = ids.length
      ? await this.workouts.aggregate<{
          _id: { workout: string; exerciseId: string };
          startedAt: Date;
          best: number | null;
        }>([
          { $match: { ...this.finishedIn(userId, window), 'exercises.exerciseId': { $in: ids } } },
          { $unwind: '$exercises' },
          { $match: { 'exercises.exerciseId': { $in: ids } } },
          ...this.loadedSets(),
          {
            $group: {
              _id: { workout: '$_id', exerciseId: '$exercises.exerciseId' },
              startedAt: { $first: '$startedAt' },
              best: metric === 'e1rm' ? { $max: E1RM_EXPR } : { $max: '$w' },
            },
          },
          { $sort: { startedAt: 1 } },
        ])
      : [];

    // Best per lift per week, then a running max: the total "so far".
    const weeks = new Map<string, Partial<Record<Lift, number>>>();
    for (const row of rows) {
      if (row.best === null) continue;
      const week = weekStartOf(localDateOf(row.startedAt, tz), firstDayOfWeek);
      const lift = liftOf.get(row._id.exerciseId)!;
      const bucket = weeks.get(week) ?? {};
      bucket[lift] = Math.max(bucket[lift] ?? 0, row.best);
      weeks.set(week, bucket);
    }
    const running: Record<Lift, number | null> = { squat: null, bench: null, deadlift: null };
    const points = [...weeks.keys()].sort().map((weekStart) => {
      for (const lift of Object.keys(running) as Lift[]) {
        const value = weeks.get(weekStart)![lift];
        if (value !== undefined) running[lift] = r1(Math.max(running[lift] ?? 0, value));
      }
      const { squat, bench, deadlift } = running;
      const total =
        squat !== null && bench !== null && deadlift !== null ? r1(squat + bench + deadlift) : null;
      return { weekStart, squat, bench, deadlift, total };
    });
    const totals = points.map((p) => p.total).filter((t): t is number => t !== null);
    return { metric, points, bestTotal: totals.length ? Math.max(...totals) : null, window };
  }

  // ===== /stats/program-adherence/:programId =====

  async programAdherence(
    userId: string,
    programId: string,
    tz: string,
  ): Promise<ProgramAdherenceDto> {
    const { window } = await this.context(userId);
    const program = await this.programs
      .findOne(notDeleted<Program>({ _id: programId, userId }))
      .lean<Program>();
    if (!program) throw new AppException(ErrorCode.PROGRAM_NOT_FOUND, HttpStatus.NOT_FOUND);

    const empty = {
      programId,
      plannedSessions: 0,
      completedSessions: 0,
      adherencePercent: null,
      extraSessions: 0,
      weeks: [],
      window,
    };
    if (!program.startDate) return empty;

    const start = program.startDate;
    const lastDay = localDateOf(program.completedAt ?? new Date(), tz);
    const windowStart = window.from ? localDateOf(window.from, tz) : start;

    const planned: { date: string; week: number }[] = [];
    program.weeks.forEach((week, i) => {
      for (const day of week.days) {
        const date = addDays(start, 7 * i + ((day.weekday - isoWeekdayOf(start) + 7) % 7));
        if (date <= lastDay && date >= windowStart) planned.push({ date, week: i + 1 });
      }
    });

    const trainedDays = await this.workouts.aggregate<{ _id: string; sessions: number }>([
      { $match: { ...this.finishedIn(userId, window), programId } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: tz } },
          sessions: { $sum: 1 },
        },
      },
    ]);
    const trained = new Map(trainedDays.map((d) => [d._id, d.sessions]));
    const plannedDates = new Set(planned.map((p) => p.date));

    const weeks = new Map<number, { planned: number; completed: number }>();
    for (const p of planned) {
      const w = weeks.get(p.week) ?? { planned: 0, completed: 0 };
      w.planned++;
      if (trained.has(p.date)) w.completed++;
      weeks.set(p.week, w);
    }
    const completedSessions = planned.filter((p) => trained.has(p.date)).length;
    return {
      programId,
      plannedSessions: planned.length,
      completedSessions,
      adherencePercent: planned.length ? r1((completedSessions / planned.length) * 100) : null,
      extraSessions: [...trained.entries()]
        .filter(([date]) => !plannedDates.has(date) && date >= start && date <= lastDay)
        .reduce((n, [, sessions]) => n + sessions, 0),
      weeks: [...weeks.entries()].sort(([a], [b]) => a - b).map(([week, w]) => ({ week, ...w })),
      window,
    };
  }

  // ===== internals =====

  /** The plan window is resolved here, once, for every endpoint (SPEC: enforced server-side). */
  private async context(userId: string, from?: Date, to?: Date): Promise<UserContext> {
    const [entitlements, user] = await Promise.all([
      this.entitlements.getForUser(userId),
      this.users.requireActiveById(userId),
    ]);
    return {
      window: statsWindow(new Date(), entitlements.statsHistoryDays, from, to),
      firstDayOfWeek: user.preferences.firstDayOfWeek,
    };
  }

  private finishedIn(userId: string, window: StatsWindow): Record<string, unknown> {
    return notDeleted<Workout>({
      userId,
      finishedAt: { $ne: null },
      startedAt: { ...(window.from && { $gte: window.from }), $lt: window.to },
    });
  }

  /** Unwinds sets and keeps completed working sets with load, exposing `w` (kg) and `r` (reps). */
  private loadedSets(): PipelineStage[] {
    return [
      { $unwind: '$exercises.sets' },
      {
        $match: {
          ...COUNTED_SET,
          'exercises.sets.weightKg': { $gt: 0 },
          'exercises.sets.reps': { $gt: 0 },
        },
      },
      { $set: { w: '$exercises.sets.weightKg', r: '$exercises.sets.reps' } },
    ];
  }

  private async dailyBuckets(
    userId: string,
    window: StatsWindow,
    tz: string,
  ): Promise<DayBucket[]> {
    return this.workouts.aggregate<DayBucket>([
      { $match: this.finishedIn(userId, window) },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: tz } },
          sessions: { $sum: 1 },
          volumeKg: { $sum: '$volumeKg' },
          workingSets: { $sum: '$workingSets' },
          durationSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }
}
