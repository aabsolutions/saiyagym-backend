import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  SyncPullQueryDto,
  SyncPullResultDto,
  SyncPushDto,
  SyncPushResultDto,
} from './dto/sync.dto';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('push')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a batch of offline changes (last write wins per document)',
    description:
      'Collections: workouts, routines, body_metrics, user_exercise_prefs. Each change gets its own ' +
      'result (applied | ignored_older | error); one failure never aborts the batch. Replaying a ' +
      'change is safe (idempotent). `updatedAt` more than 5 min in the future → CLOCK_SKEW.',
  })
  push(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SyncPushDto,
    @I18nLang() lang: string,
  ): Promise<SyncPushResultDto> {
    return this.sync.push(user.id, lang, dto.changes);
  }

  @Get('pull')
  @ApiOperation({
    summary: 'Everything of yours changed since `since` (deletions included)',
    description:
      'Use the returned `serverTime` as the next `since`. The cursor is the server write time, ' +
      'not the client `updatedAt`, so offline edits pushed late are never missed.',
  })
  pull(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SyncPullQueryDto,
  ): Promise<SyncPullResultDto> {
    return this.sync.pull(user.id, query.since);
  }
}
