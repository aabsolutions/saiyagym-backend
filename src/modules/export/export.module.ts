import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BodyMetric, BodyMetricSchema } from '../body-metrics/schemas/body-metric.schema';
import { Exercise, ExerciseSchema } from '../exercises/schemas/exercise.schema';
import { Workout, WorkoutSchema } from '../workouts/schemas/workout.schema';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

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
