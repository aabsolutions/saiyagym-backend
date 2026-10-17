import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { notDeleted } from '../../database/base.schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { statsWindow } from '../stats/stats-window';
import { SyncRegistry } from '../sync/sync.registry';
import {
  BodyMetricBodyDto,
  BodyMetricDto,
  BodyMetricListQueryDto,
  BodyMetricPageDto,
  BodyMetricSeriesDto,
  BodyMetricSeriesQueryDto,
  CreateBodyMetricDto,
  UpdateBodyMetricDto,
} from './dto/body-metric.dto';
import { BodyMetric, MEASUREMENT_FIELDS } from './schemas/body-metric.schema';

type Filter = QueryFilter<BodyMetric>;

@Injectable()
export class BodyMetricsService implements OnModuleInit {
  constructor(
    @InjectModel(BodyMetric.name) private readonly metrics: Model<BodyMetric>,
    private readonly entitlements: EntitlementsService,
    private readonly sync: SyncRegistry,
  ) {}

  onModuleInit(): void {
    this.sync.register({
      collection: 'body_metrics',
      model: this.metrics,
      push: {
        dto: BodyMetricBodyDto,
        prepare: (_ctx, payload) => Promise.resolve(toStored(payload as BodyMetricBodyDto)),
      },
    });
  }

  async list(userId: string, query: BodyMetricListQueryDto): Promise<BodyMetricPageDto> {
    const filter: Filter = notDeleted<BodyMetric>({ userId });
    if (query.from || query.to) {
      filter.measuredAt = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lt: query.to }),
      };
    }
    const [items, total] = await Promise.all([
      this.metrics
        .find(filter)
        .sort({ measuredAt: -1, _id: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<BodyMetric[]>(),
      this.metrics.countDocuments(filter),
    ]);
    return { items: items.map(toDto), meta: { page: query.page, limit: query.limit, total } };
  }

  /** Most recent recorded body weight (entries without weight are skipped), or null. */
  async latestWeightKg(userId: string): Promise<number | null> {
    const latest = await this.metrics
      .findOne(notDeleted<BodyMetric>({ userId, weightKg: { $ne: null } }), { weightKg: 1 })
      .sort({ measuredAt: -1 })
      .lean<Pick<BodyMetric, 'weightKg'>>();
    return latest?.weightKg ?? null;
  }

  async get(userId: string, id: string): Promise<BodyMetricDto> {
    return toDto(await this.requireOwned(userId, id));
  }

  /** Idempotent on the client id, like workouts. */
  async create(
    userId: string,
    dto: CreateBodyMetricDto,
  ): Promise<{ created: boolean; metric: BodyMetricDto }> {
    if (dto.id) {
      const existing = await this.metrics.findById(dto.id).lean<BodyMetric>();
      if (existing) {
        if (existing.userId !== userId)
          throw new AppException(ErrorCode.CONFLICT, HttpStatus.CONFLICT);
        if (existing.deletedAt) throw notFound();
        return { created: false, metric: toDto(existing) };
      }
    }
    const created = await this.metrics.create({
      ...toStored(dto),
      ...(dto.id && { _id: dto.id }),
      userId,
    });
    return { created: true, metric: toDto(created.toObject()) };
  }

  async update(userId: string, id: string, dto: UpdateBodyMetricDto): Promise<BodyMetricDto> {
    const existing = await this.requireOwned(userId, id);
    const merged = { ...existing, ...stripUndefined(dto) } as BodyMetricBodyDto;
    const updated = await this.metrics
      .findOneAndUpdate(
        notDeleted<BodyMetric>({ _id: id, userId }),
        { $set: toStored(merged) },
        { returnDocument: 'after' },
      )
      .lean<BodyMetric>();
    if (!updated) throw notFound();
    return toDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.metrics.updateOne({ _id: id, userId }, { deletedAt: new Date() });
  }

  /** Time series of one measurement. It's a statistic: the plan's history window applies. */
  async series(userId: string, query: BodyMetricSeriesQueryDto): Promise<BodyMetricSeriesDto> {
    const { statsHistoryDays } = await this.entitlements.getForUser(userId);
    const window = statsWindow(new Date(), statsHistoryDays, query.from, query.to);
    const docs = await this.metrics
      .find(
        notDeleted<BodyMetric>({
          userId,
          [query.metric]: { $ne: null },
          measuredAt: { ...(window.from && { $gte: window.from }), $lt: window.to },
        }),
        { measuredAt: 1, [query.metric]: 1 },
      )
      .sort({ measuredAt: 1 })
      .lean<BodyMetric[]>();
    return {
      metric: query.metric,
      points: docs.map((d) => ({ measuredAt: d.measuredAt, value: d[query.metric]! })),
      window,
    };
  }

  private async requireOwned(userId: string, id: string): Promise<BodyMetric> {
    const metric = await this.metrics
      .findOne(notDeleted<BodyMetric>({ _id: id, userId }))
      .lean<BodyMetric>();
    if (!metric) throw notFound();
    return metric;
  }
}

/** Normalizes and enforces "at least one measurement" (REST and sync alike). */
function toStored(dto: BodyMetricBodyDto): Record<string, unknown> {
  const values = Object.fromEntries(MEASUREMENT_FIELDS.map((field) => [field, dto[field] ?? null]));
  if (Object.values(values).every((value) => value === null)) {
    throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
      details: [{ field: 'doc', constraints: ['atLeastOneMeasurement'] }],
    });
  }
  return { measuredAt: dto.measuredAt, notes: dto.notes ?? '', ...values };
}

function toDto(m: BodyMetric): BodyMetricDto {
  return {
    id: m._id,
    measuredAt: m.measuredAt,
    ...(Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f, m[f]])) as Pick<
      BodyMetricDto,
      (typeof MEASUREMENT_FIELDS)[number]
    >),
    notes: m.notes,
    updatedAt: m.updatedAt,
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function notFound(): AppException {
  return new AppException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
}
