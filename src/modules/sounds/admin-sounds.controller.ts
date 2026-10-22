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
import { Role } from '../../common/constants/role';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AdminRestSoundDto,
  AdminRestSoundPageDto,
  AdminRestSoundQueryDto,
  CreateRestSoundDto,
  UpdateRestSoundDto,
} from './dto/rest-sound.dto';
import { SoundsService } from './sounds.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/** Admin views return raw `{ es, en }` maps. Deletes are soft; slugs stay reserved. */
@ApiTags('admin / sounds')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/sounds')
export class AdminSoundsController {
  constructor(private readonly sounds: SoundsService) {}

  @Get()
  list(@Query() query: AdminRestSoundQueryDto): Promise<AdminRestSoundPageDto> {
    return this.sounds.listAdmin(query);
  }

  @Get(':id')
  get(@Param('id', UUID) id: string): Promise<AdminRestSoundDto> {
    return this.sounds.getAdmin(id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Upload first with a rest_sound signature (POST /media/upload-signature), then send its ' +
      'publicId. The API verifies size/duration/format with Cloudinary (400 INVALID_SOUND_ASSET).',
  })
  create(@Body() dto: CreateRestSoundDto): Promise<AdminRestSoundDto> {
    return this.sounds.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateRestSoundDto,
  ): Promise<AdminRestSoundDto> {
    return this.sounds.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete; the Cloudinary asset is kept for cached clients' })
  async remove(@Param('id', UUID) id: string): Promise<void> {
    await this.sounds.remove(id);
  }
}
