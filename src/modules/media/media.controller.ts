import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { UploadSignatureDto, UploadSignatureRequestDto } from './dto/media.dto';
import { MediaService } from './media.service';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('upload-signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Signed Cloudinary upload parameters',
    description:
      'POST multipart/form-data to `uploadUrl` with `file`, `api_key`, `signature` and every ' +
      'field of `params` unchanged. Exercise images: send `secure_url` as `imageUrl`. Progress ' +
      'photos (Premium): send `public_id` and `format` to POST /progress-photos.',
  })
  async createSignature(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadSignatureRequestDto,
  ): Promise<UploadSignatureDto> {
    // Premium is checked BEFORE signing: a signature is a capability to store a file on our account.
    if (dto.purpose === 'progress_photo') {
      await this.entitlements.assertFeature(user.id, 'progressPhotos');
    }
    return this.media.createUploadSignature(dto.purpose, user);
  }
}
