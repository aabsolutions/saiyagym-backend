import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { GuidesDto, ResolveGuidesDto } from './dto/guide.dto';
import { GuidesService } from './guides.service';

@ApiTags('guides')
@ApiBearerAuth()
@Controller('guides')
export class GuidesController {
  constructor(private readonly guides: GuidesService) {}

  @Get()
  @ApiOperation({
    summary: 'Execution guides the caller may see',
    description:
      'Premium: every guide. Otherwise the first `guidesPerRoutine` exercises with guides of ' +
      'each routine (routine order). `lockedExerciseIds` = exercises with guides not unlocked.',
  })
  list(@CurrentUser() user: AuthenticatedUser, @I18nLang() lang: string): Promise<GuidesDto> {
    return this.guides.forUser(user.id, lang);
  }

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Guides for a session without a routine',
    description:
      'Same as GET /guides restricted to `exerciseIds`, also unlocking the first ' +
      '`guidesPerRoutine` of them that have guides (in the order sent).',
  })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ResolveGuidesDto,
    @I18nLang() lang: string,
  ): Promise<GuidesDto> {
    return this.guides.resolve(user.id, dto.exerciseIds, lang);
  }
}
