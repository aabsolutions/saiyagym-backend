import { Module } from '@nestjs/common';
import { ExercisesModule } from '../exercises/exercises.module';
import { MediaModule } from '../media/media.module';
import { RoutinesModule } from '../routines/routines.module';
import { GuidesController } from './guides.controller';
import { GuidesService } from './guides.service';

/** Plan-gated reads of exercise execution guides (admin writes live in ExercisesModule). */
@Module({
  imports: [ExercisesModule, RoutinesModule, MediaModule],
  controllers: [GuidesController],
  providers: [GuidesService],
})
export class GuidesModule {}
