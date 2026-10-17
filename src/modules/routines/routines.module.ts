import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExercisesModule } from '../exercises/exercises.module';
import { RoutineUsageRegistry } from './routine-usage.registry';
import { RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';
import { Routine, RoutineSchema } from './schemas/routine.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Routine.name, schema: RoutineSchema }]),
    ExercisesModule,
  ],
  controllers: [RoutinesController],
  providers: [RoutinesService, RoutineUsageRegistry],
  exports: [RoutinesService, RoutineUsageRegistry],
})
export class RoutinesModule {}
