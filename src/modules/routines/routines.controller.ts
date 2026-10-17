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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CheckLimit } from '../entitlements/entitlements.decorators';
import {
  CreateRoutineDto,
  ReorderRoutineExercisesDto,
  RoutineDetailDto,
  RoutineListQueryDto,
  RoutinePageDto,
  UpdateRoutineDto,
} from './dto/routine.dto';
import { RoutinesService } from './routines.service';

const UUID = new ParseUUIDPipe({ version: '4' });

@ApiTags('routines')
@ApiBearerAuth()
@Controller('routines')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RoutineListQueryDto,
  ): Promise<RoutinePageDto> {
    return this.routines.list(user.id, query);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @I18nLang() lang: string,
  ): Promise<RoutineDetailDto> {
    return this.routines.detail(user.id, id, lang);
  }

  @Post()
  @CheckLimit('routines')
  @ApiOperation({
    summary: 'Create a routine (plan limit). Progression rules require autoProgression (Premium).',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRoutineDto,
    @I18nLang() lang: string,
  ): Promise<RoutineDetailDto> {
    return this.routines.create(user.id, dto, lang);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update; `exercises` replaces the whole list' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: UpdateRoutineDto,
    @I18nLang() lang: string,
  ): Promise<RoutineDetailDto> {
    return this.routines.update(user.id, id, dto, lang);
  }

  @Put(':id/exercises/order')
  @ApiOperation({ summary: 'Reorder exercises: send every slot id once, in the new order' })
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: ReorderRoutineExercisesDto,
    @I18nLang() lang: string,
  ): Promise<RoutineDetailDto> {
    return this.routines.reorder(user.id, id, dto.itemIds, lang);
  }

  @Post(':id/duplicate')
  @CheckLimit('routines')
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @I18nLang() lang: string,
  ): Promise<RoutineDetailDto> {
    return this.routines.duplicate(user.id, id, lang);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hide the routine; frees a plan slot. Programs can still use it.' })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.routines.archive(user.id, id);
  }

  @Post(':id/unarchive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore an archived routine (counts toward the plan limit again)' })
  async unarchive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.routines.unarchive(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete. 409 ROUTINE_IN_USE if a draft/active program uses it.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.routines.remove(user.id, id);
  }
}
