import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { Model } from 'mongoose';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { toCsv } from '../../common/utils/csv.util';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import {
  BodyMetric,
  BodyMetricSchema,
  MEASUREMENT_FIELDS,
} from '../body-metrics/schemas/body-metric.schema';
import { RequireFeature } from '../entitlements/entitlements.decorators';
import { Exercise, ExerciseSchema } from '../exercises/schemas/exercise.schema';
import { Workout, WorkoutSchema } from '../workouts/schemas/workout.schema';

export class ExportQueryDto {
  @IsIn(['csv', 'json'])
  format!: 'csv' | 'json';

  /** CSV holds one table: pick which. JSON always includes everything. */
  @IsOptional()
  @IsIn(['workouts', 'measurements'])
  dataset: 'workouts' | 'measurements' = 'workouts';
}

@Injectable()
export class ExportService {
  constructor(
    @InjectModel(Workout.name) private readonly workouts: Model<Workout>,
    @InjectModel(BodyMetric.name) private readonly metrics: Model<BodyMetric>,
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
  ) {}

  /** Full history — export is about owning your data, so the stats window doesn't apply. */
  async json(userId: string, lang: string) {
    const [workouts, measurements] = await Promise.all([
      this.loadWorkouts(userId),
      this.loadMetrics(userId),
    ]);
    const names = await this.exerciseNames(userId, workouts, lang);
    return {
      format: 'gymapp-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      units: { weight: 'kg', length: 'cm' },
      workouts: workouts.map((w) => ({
        id: w._id,
        name: w.name,
        startedAt: w.startedAt,
        finishedAt: w.finishedAt,
        durationSeconds: w.durationSeconds,
        rating: w.rating,
        notes: w.notes,
        volumeKg: w.volumeKg,
        exercises: w.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          exercise: names.get(e.exerciseId) ?? null,
          notes: e.notes,
          sets: e.sets.map((s) => ({
            type: s.type,
            weightKg: s.weightKg,
            reps: s.reps,
            completed: s.completed,
          })),
        })),
      })),
      measurements: measurements.map((m) => ({
        id: m._id,
        measuredAt: m.measuredAt,
        ...Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f, m[f]])),
        notes: m.notes,
      })),
    };
  }

  /** One row per set (the shape spreadsheets and other apps import). */
  async workoutsCsv(userId: string, lang: string): Promise<string> {
    const workouts = await this.loadWorkouts(userId);
    const names = await this.exerciseNames(userId, workouts, lang);
    const rows = workouts.flatMap((w) =>
      w.exercises.flatMap((e) =>
        e.sets.map((s, i) => [
          w.startedAt,
          w.name,
          names.get(e.exerciseId) ?? e.exerciseId,
          i + 1,
          s.type,
          s.weightKg,
          s.reps,
          s.completed,
          w.durationSeconds,
          w.rating,
          e.notes,
        ]),
      ),
    );
    return toCsv(
      [
        'started_at',
        'workout',
        'exercise',
        'set',
        'set_type',
        'weight_kg',
        'reps',
        'completed',
        'workout_duration_s',
        'rating',
        'exercise_notes',
      ],
      rows,
    );
  }

  async measurementsCsv(userId: string): Promise<string> {
    const metrics = await this.loadMetrics(userId);
    return toCsv(
      ['measured_at', ...MEASUREMENT_FIELDS.map(snake), 'notes'],
      metrics.map((m) => [m.measuredAt, ...MEASUREMENT_FIELDS.map((f) => m[f]), m.notes]),
    );
  }

  private loadWorkouts(userId: string): Promise<Workout[]> {
    return this.workouts
      .find(notDeleted<Workout>({ userId }))
      .sort({ startedAt: 1 })
      .lean<Workout[]>();
  }

  private loadMetrics(userId: string): Promise<BodyMetric[]> {
    return this.metrics
      .find(notDeleted<BodyMetric>({ userId }))
      .sort({ measuredAt: 1 })
      .lean<BodyMetric[]>();
  }

  /** Includes the user's own DELETED custom exercises: old sessions still need a name. */
  private async exerciseNames(
    userId: string,
    workouts: Workout[],
    lang: string,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)))];
    const docs = await this.exercises
      .find({ _id: { $in: ids }, $or: [{ isGlobal: true }, { ownerId: userId }] }, { name: 1 })
      .lean<Exercise[]>();
    return new Map(docs.map((d) => [d._id, localize(d.name, lang)]));
  }
}

const snake = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

@ApiTags('export')
@ApiBearerAuth()
@Controller('export')
export class ExportController {
  constructor(private readonly exporter: ExportService) {}

  @Get()
  @RequireFeature('dataExport')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Download your workouts and measurements (Premium)',
    description:
      '`format=json` → everything. `format=csv&dataset=workouts|measurements` → one table.',
  })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportQueryDto,
    @I18nLang() lang: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const stamp = new Date().toISOString().slice(0, 10);
    if (query.format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="gymapp-export-${stamp}.json"`);
      return this.exporter.json(user.id, lang);
    }
    const csv =
      query.dataset === 'measurements'
        ? await this.exporter.measurementsCsv(user.id)
        : await this.exporter.workoutsCsv(user.id, lang);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gymapp-${query.dataset}-${stamp}.csv"`,
    );
    return csv; // passthrough: Nest sends it; calling res.send() too would reply twice
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workout.name, schema: WorkoutSchema },
      { name: BodyMetric.name, schema: BodyMetricSchema },
      { name: Exercise.name, schema: ExerciseSchema },
    ]),
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
