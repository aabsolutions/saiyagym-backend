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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  ActivateProgramDto,
  CreateProgramDto,
  ProgramDto,
  ProgramListQueryDto,
  TodayDto,
  TodayQueryDto,
  UpdateProgramDto,
} from './dto/program.dto';
import { ProgramsService } from './programs.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/** `active/today` is declared before `:id` so it isn't captured as an id. */
@ApiTags('programs')
@ApiBearerAuth()
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProgramListQueryDto,
  ): Promise<ProgramDto[]> {
    return this.programs.list(user.id, query);
  }

  @Get('active/today')
  @ApiOperation({
    summary: 'Routine scheduled for `date` in the active program, with computed target weights',
    description:
      'Send `date` as the client’s LOCAL date (YYYY-MM-DD). `status` is training | rest | ' +
      'not_started | finished. Each exercise lists `adjustments` explaining the targets.',
  })
  today(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TodayQueryDto,
    @I18nLang() lang: string,
  ): Promise<TodayDto> {
    return this.programs.today(user.id, lang, query.date, query.programId);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<ProgramDto> {
    return this.programs.detail(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft program (weeks → days → routineId)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProgramDto,
  ): Promise<ProgramDto> {
    return this.programs.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update. Completed programs only accept name/notes.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: UpdateProgramDto,
  ): Promise<ProgramDto> {
    return this.programs.update(user.id, id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'draft → active. Free plans allow one active program (403 PLAN_LIMIT_REACHED).',
  })
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: ActivateProgramDto,
  ): Promise<ProgramDto> {
    return this.programs.activate(user.id, id, dto.startDate);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'active → draft (frees the active slot)' })
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<ProgramDto> {
    return this.programs.deactivate(user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'active → completed (final)' })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<ProgramDto> {
    return this.programs.complete(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.programs.remove(user.id, id);
  }
}
