import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExercisesModule } from '../exercises/exercises.module';
import { Workout, WorkoutSchema } from '../workouts/schemas/workout.schema';
import { PersonalRecordsService } from './personal-records.service';
import { RecordsController } from './records.controller';
import { PersonalRecord, PersonalRecordSchema } from './schemas/personal-record.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PersonalRecord.name, schema: PersonalRecordSchema },
      { name: Workout.name, schema: WorkoutSchema },
    ]),
    ExercisesModule,
  ],
  controllers: [RecordsController],
  providers: [PersonalRecordsService],
  exports: [PersonalRecordsService],
})
export class RecordsModule {}
