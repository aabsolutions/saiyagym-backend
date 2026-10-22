import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RestSoundListDto } from './dto/rest-sound.dto';
import { SoundsService } from './sounds.service';

@ApiTags('sounds')
@ApiBearerAuth()
@Controller('sounds')
export class SoundsController {
  constructor(private readonly sounds: SoundsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Rest-alarm sounds in admin order. Premium ones are `locked` (and have no URLs) without premiumSounds.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @I18nLang() lang: string,
  ): Promise<RestSoundListDto> {
    return this.sounds.list(user.id, lang);
  }
}
