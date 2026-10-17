import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExercisesModule } from '../exercises/exercises.module';
import { RoutinesModule } from '../routines/routines.module';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { ProgressionService } from './progression/progression.service';
import { WorkoutHistoryAdapter } from '../workouts/workout-history.adapter';
import { WorkoutsModule } from '../workouts/workouts.module';
import { WorkoutHistoryProvider } from './progression/workout-history.provider';
import { Program, ProgramSchema } from './schemas/program.schema';
import { ProgramTemplate, ProgramTemplateSchema } from './templates/program-template.schema';
import {
  AdminProgramTemplatesController,
  ProgramTemplatesController,
} from './templates/program-templates.controller';
import { ProgramTemplatesSeeder } from './templates/program-templates.seeder';
import { ProgramTemplatesService } from './templates/program-templates.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Program.name, schema: ProgramSchema },
      { name: ProgramTemplate.name, schema: ProgramTemplateSchema },
    ]),
    RoutinesModule,
    ExercisesModule,
    WorkoutsModule,
  ],
  controllers: [ProgramsController, ProgramTemplatesController, AdminProgramTemplatesController],
  providers: [
    ProgramsService,
    ProgressionService,
    ProgramTemplatesService,
    ProgramTemplatesSeeder,
    // Port → workouts-backed adapter (EmptyWorkoutHistoryProvider remains for isolated tests).
    { provide: WorkoutHistoryProvider, useExisting: WorkoutHistoryAdapter },
  ],
  exports: [ProgramsService, ProgressionService],
})
export class ProgramsModule {}
