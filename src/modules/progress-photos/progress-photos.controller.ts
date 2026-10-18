import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RequireFeature } from '../entitlements/entitlements.decorators';
import {
  CompareDto,
  CompareQueryDto,
  CreateProgressPhotoDto,
  ProgressPhotoDto,
  ProgressPhotoListQueryDto,
  ProgressPhotoPageDto,
} from './dto/progress-photo.dto';
import { ProgressPhotosService } from './progress-photos.service';

/**
 * Creating requires Premium. Listing, comparing and deleting don't: after a downgrade users keep
 * access to (and can delete) their own photos. In a `*.controller.ts` file on purpose: the
 * swagger plugin only infers responses there.
 */
@ApiTags('progress photos')
@ApiBearerAuth()
@Controller('progress-photos')
export class ProgressPhotosController {
  constructor(private readonly photos: ProgressPhotosService) {}

  @Post()
  @RequireFeature('progressPhotos')
  @ApiOperation({ summary: 'Register an uploaded progress photo (Premium)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProgressPhotoDto,
  ): Promise<ProgressPhotoDto> {
    return this.photos.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProgressPhotoListQueryDto,
  ): Promise<ProgressPhotoPageDto> {
    return this.photos.list(user.id, query);
  }

  @Get('compare')
  @ApiOperation({ summary: 'Before/after for one view (earliest vs latest in range)' })
  compare(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompareQueryDto,
  ): Promise<CompareDto> {
    return this.photos.compare(user.id, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the photo and its Cloudinary asset' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    await this.photos.remove(user.id, id);
  }
}
