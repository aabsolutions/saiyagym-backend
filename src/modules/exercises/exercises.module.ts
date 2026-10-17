import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaModule } from '../media/media.module';
import {
  AdminExercisesController,
  AdminExerciseTagsController,
  ExerciseTagsController,
} from './admin-exercises.controller';
import { ExercisePrefsService } from './exercise-prefs.service';
import { ExerciseTagsService } from './exercise-tags.service';
import { ExercisesController } from './exercises.controller';
import { ExercisesSeeder } from './exercises.seeder';
import { ExercisesService } from './exercises.service';
import { Exercise, ExerciseSchema } from './schemas/exercise.schema';
import { ExerciseTag, ExerciseTagSchema } from './schemas/exercise-tag.schema';
import { UserExercisePref, UserExercisePrefSchema } from './schemas/user-exercise-pref.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Exercise.name, schema: ExerciseSchema },
      { name: ExerciseTag.name, schema: ExerciseTagSchema },
      { name: UserExercisePref.name, schema: UserExercisePrefSchema },
    ]),
    MediaModule,
  ],
  controllers: [
    ExercisesController,
    ExerciseTagsController,
    AdminExercisesController,
    AdminExerciseTagsController,
  ],
  providers: [ExercisesService, ExerciseTagsService, ExercisePrefsService, ExercisesSeeder],
  exports: [ExercisesService, ExercisesSeeder],
})
export class ExercisesModule {}
