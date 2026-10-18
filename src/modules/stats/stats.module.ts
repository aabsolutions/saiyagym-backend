import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExercisesModule } from '../exercises/exercises.module';
import { Program, ProgramSchema } from '../programs/schemas/program.schema';
import { UsersModule } from '../users/users.module';
import { Workout, WorkoutSchema } from '../workouts/schemas/workout.schema';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workout.name, schema: WorkoutSchema },
      { name: Program.name, schema: ProgramSchema },
    ]),
    UsersModule,
    ExercisesModule,
  ],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
