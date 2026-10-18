import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RequireFeature } from '../entitlements/entitlements.decorators';
import { ExportQueryDto } from './dto/export.dto';
import { ExportService } from './export.service';

/** The query DTO lives in a `*.dto.ts` file so the swagger plugin documents its params. */
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
