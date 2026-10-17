import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { BodyMetricsService } from './body-metrics.service';
import {
  BodyMetricDto,
  BodyMetricListQueryDto,
  BodyMetricPageDto,
  BodyMetricSeriesDto,
  BodyMetricSeriesQueryDto,
  CreateBodyMetricDto,
  UpdateBodyMetricDto,
} from './dto/body-metric.dto';
import { BodyMetric, BodyMetricSchema } from './schemas/body-metric.schema';

const UUID = new ParseUUIDPipe({ version: '4' });

/** `series` is declared before `:id`. */
@ApiTags('body metrics')
@ApiBearerAuth()
@Controller('body-metrics')
export class BodyMetricsController {
  constructor(private readonly metrics: BodyMetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Measurement entries, newest first (full history)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BodyMetricListQueryDto,
  ): Promise<BodyMetricPageDto> {
    return this.metrics.list(user.id, query);
  }

  @Get('series')
  @ApiOperation({ summary: 'Time series of one measurement (Free: last 90 days)' })
  series(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BodyMetricSeriesQueryDto,
  ): Promise<BodyMetricSeriesDto> {
    return this.metrics.series(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<BodyMetricDto> {
    return this.metrics.get(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Record measurements (kg/cm/%). Idempotent on the client `id`.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBodyMetricDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BodyMetricDto> {
    const { created, metric } = await this.metrics.create(user.id, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return metric;
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: UpdateBodyMetricDto,
  ): Promise<BodyMetricDto> {
    return this.metrics.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.metrics.remove(user.id, id);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: BodyMetric.name, schema: BodyMetricSchema }])],
  controllers: [BodyMetricsController],
  providers: [BodyMetricsService],
  exports: [BodyMetricsService],
})
export class BodyMetricsModule {}
