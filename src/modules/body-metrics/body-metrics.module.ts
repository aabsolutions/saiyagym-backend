import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BodyMetricsController } from './body-metrics.controller';
import { BodyMetricsService } from './body-metrics.service';
import { BodyMetric, BodyMetricSchema } from './schemas/body-metric.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: BodyMetric.name, schema: BodyMetricSchema }])],
  controllers: [BodyMetricsController],
  providers: [BodyMetricsService],
  exports: [BodyMetricsService],
})
export class BodyMetricsModule {}
