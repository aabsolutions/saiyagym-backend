import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { I18nLang } from 'nestjs-i18n';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  CreateWorkoutDto,
  ExerciseHistoryPageDto,
  LastPerformanceDto,
  UpdateWorkoutDto,
  WorkoutDetailDto,
  WorkoutSaveResultDto,
  WorkoutListQueryDto,
  WorkoutPageDto,
} from './dto/workout.dto';
import { WorkoutsService } from './workouts.service';

const UUID = new ParseUUIDPipe({ version: '4' });

@ApiTags('workouts')
@ApiBearerAuth()
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Post()
  @ApiOperation({
    summary: 'Log a workout (idempotent on the client `id`)',
    description: '201 when created; 200 with the stored workout when that `id` already exists.',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkoutDto,
    @I18nLang() lang: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkoutSaveResultDto> {
    const { created, workout } = await this.workouts.create(user.id, dto, lang);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return workout;
  }

  @Get()
  @ApiOperation({ summary: 'Newest first; `from`/`to` filter on startedAt' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: WorkoutListQueryDto,
  ): Promise<WorkoutPageDto> {
    return this.workouts.list(user.id, query);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @I18nLang() lang: string,
  ): Promise<WorkoutDetailDto> {
    return this.workouts.detail(user.id, id, lang);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update; `exercises` replaces the whole list' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: UpdateWorkoutDto,
    @I18nLang() lang: string,
  ): Promise<WorkoutSaveResultDto> {
    return this.workouts.update(user.id, id, dto, lang);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.workouts.remove(user.id, id);
  }
}

/** Exercise-centric views of the user's workouts. */
@ApiTags('exercises')
@ApiBearerAuth()
@Controller('exercises')
export class ExercisePerformanceController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Get(':id/last-performance')
  @ApiOperation({ summary: 'Sets from the last FINISHED session of this exercise ("last time")' })
  last(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<LastPerformanceDto> {
    return this.workouts.lastPerformance(user.id, id);
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'Past sessions of this exercise, newest first, with volume and best e1RM',
  })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ExerciseHistoryPageDto> {
    return this.workouts.exerciseHistory(user.id, id, query.page, query.limit);
  }
}
