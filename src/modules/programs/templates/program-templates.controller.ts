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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { Role } from '../../../common/constants/role';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import {
  AdminProgramTemplateDto,
  CopyProgramTemplateDto,
  CopyProgramTemplateResultDto,
  CreateProgramTemplateDto,
  ProgramTemplateDetailDto,
  ProgramTemplateSummaryDto,
  UpdateProgramTemplateDto,
} from './program-template.dto';
import { ProgramTemplatesService } from './program-templates.service';

const UUID = new ParseUUIDPipe({ version: '4' });

@ApiTags('programs')
@ApiBearerAuth()
@Controller('program-templates')
export class ProgramTemplatesController {
  constructor(private readonly templates: ProgramTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Global program templates, localized' })
  list(@I18nLang() lang: string): Promise<ProgramTemplateSummaryDto[]> {
    return this.templates.list(lang);
  }

  @Get(':id')
  detail(
    @Param('id', UUID) id: string,
    @I18nLang() lang: string,
  ): Promise<ProgramTemplateDetailDto> {
    return this.templates.detail(id, lang);
  }

  @Post(':id/copy')
  @ApiOperation({
    summary: 'Copy into your own routines + a draft program',
    description:
      'Needs room for all its routines in your plan (403 PLAN_LIMIT_REACHED with `requested`). ' +
      'Without autoProgression the progression rules are dropped (`progressionRulesDropped`).',
  })
  copy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: CopyProgramTemplateDto,
    @I18nLang() lang: string,
  ): Promise<CopyProgramTemplateResultDto> {
    return this.templates.copy(user.id, id, dto, lang);
  }
}

@ApiTags('admin / programs')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/program-templates')
export class AdminProgramTemplatesController {
  constructor(private readonly templates: ProgramTemplatesService) {}

  @Get()
  list(): Promise<AdminProgramTemplateDto[]> {
    return this.templates.adminList();
  }

  @Get(':id')
  findOne(@Param('id', UUID) id: string): Promise<AdminProgramTemplateDto> {
    return this.templates.adminGet(id);
  }

  @Post()
  create(@Body() dto: CreateProgramTemplateDto): Promise<AdminProgramTemplateDto> {
    return this.templates.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateProgramTemplateDto,
  ): Promise<AdminProgramTemplateDto> {
    return this.templates.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', UUID) id: string): Promise<void> {
    await this.templates.remove(id);
  }
}
