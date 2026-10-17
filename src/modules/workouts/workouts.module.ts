import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExercisesModule } from '../exercises/exercises.module';
import { Program, ProgramSchema } from '../programs/schemas/program.schema';
import { RoutinesModule } from '../routines/routines.module';
import { Workout, WorkoutSchema } from './schemas/workout.schema';
import { WorkoutHistoryAdapter } from './workout-history.adapter';
import { ExercisePerformanceController, WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workout.name, schema: WorkoutSchema },
      { name: Program.name, schema: ProgramSchema },
    ]),
    ExercisesModule,
    RoutinesModule,
  ],
  controllers: [WorkoutsController, ExercisePerformanceController],
  providers: [WorkoutsService, WorkoutHistoryAdapter],
  exports: [WorkoutsService, WorkoutHistoryAdapter],
})
export class WorkoutsModule {}
