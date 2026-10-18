import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  ExerciseStatsDto,
  FrequencyDto,
  FrequencyQueryDto,
  MuscleVolumeDto,
  PowerliftingTotalDto,
  PowerliftingTotalQueryDto,
  ProgramAdherenceDto,
  RangeQueryDto,
  SummaryDto,
  TimeZoneQueryDto,
} from './dto/stats.dto';
import { StatsService } from './stats.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * In a `*.controller.ts` file on purpose: the swagger plugin only infers responses there.
 * Every response carries `window`: the range actually used (Free: last 90 days, server-side).
 */
@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Sessions, volume and time this week/month + weekly streak' })
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: TimeZoneQueryDto,
  ): Promise<SummaryDto> {
    return this.stats.summary(user.id, q.tz);
  }

  @Get('exercise/:id')
  @ApiOperation({ summary: 'Per session: max weight, best e1RM and volume of one exercise' })
  exercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Query() q: RangeQueryDto,
  ): Promise<ExerciseStatsDto> {
    return this.stats.exercise(user.id, id, q.tz, q.from, q.to);
  }

  @Get('muscle-volume')
  @ApiOperation({ summary: 'Working sets and kg per primary muscle and week' })
  muscleVolume(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: RangeQueryDto,
  ): Promise<MuscleVolumeDto> {
    return this.stats.muscleVolume(user.id, q.tz, q.from, q.to);
  }

  @Get('frequency')
  @ApiOperation({ summary: 'Days trained per week and a yearly heatmap' })
  frequency(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: FrequencyQueryDto,
  ): Promise<FrequencyDto> {
    return this.stats.frequency(user.id, q.tz, q.year);
  }

  @Get('powerlifting-total')
  @ApiOperation({ summary: 'Squat + bench + deadlift total over time (running best)' })
  powerliftingTotal(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: PowerliftingTotalQueryDto,
  ): Promise<PowerliftingTotalDto> {
    return this.stats.powerliftingTotal(user.id, q.tz, q.metric, q.from, q.to);
  }

  @Get('program-adherence/:programId')
  @ApiOperation({ summary: 'Planned vs completed training days of a program' })
  programAdherence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programId', UUID) programId: string,
    @Query() q: TimeZoneQueryDto,
  ): Promise<ProgramAdherenceDto> {
    return this.stats.programAdherence(user.id, programId, q.tz);
  }
}
