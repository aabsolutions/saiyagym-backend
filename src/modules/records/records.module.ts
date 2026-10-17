import { Controller, Get, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ExercisesModule } from '../exercises/exercises.module';
import { Workout, WorkoutSchema } from '../workouts/schemas/workout.schema';
import { ExerciseRecordsDto, RecordsSummaryItemDto } from './dto/records.dto';
import { PersonalRecordsService } from './personal-records.service';
import { PersonalRecord, PersonalRecordSchema } from './schemas/personal-record.schema';

@ApiTags('stats')
@ApiBearerAuth()
@Controller()
export class RecordsController {
  constructor(private readonly records: PersonalRecordsService) {}

  @Get('records')
  @ApiOperation({ summary: 'Your records per exercise (all-time)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @I18nLang() lang: string,
  ): Promise<RecordsSummaryItemDto[]> {
    return this.records.listForUser(user.id, lang);
  }

  @Get('exercises/:id/records')
  @ApiOperation({ summary: 'All records of one exercise, including most reps at each weight' })
  forExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ExerciseRecordsDto> {
    return this.records.forExercise(user.id, id);
  }
}

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
