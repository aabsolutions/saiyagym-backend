import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { notDeleted } from '../../database/base.schema';
import { RequireFeature } from '../entitlements/entitlements.decorators';
import { MediaModule } from '../media/media.module';
import { MediaService } from '../media/media.service';
import {
  CompareDto,
  CompareQueryDto,
  CreateProgressPhotoDto,
  ProgressPhotoDto,
  ProgressPhotoListQueryDto,
  ProgressPhotoPageDto,
} from './dto/progress-photo.dto';
import {
  ProgressPhoto,
  ProgressPhotoSchema,
  type PhotoView,
} from './schemas/progress-photo.schema';

type Filter = QueryFilter<ProgressPhoto>;

@Injectable()
export class ProgressPhotosService {
  constructor(
    @InjectModel(ProgressPhoto.name) private readonly photos: Model<ProgressPhoto>,
    private readonly media: MediaService,
  ) {}

  async create(userId: string, dto: CreateProgressPhotoDto): Promise<ProgressPhotoDto> {
    // Only files our signature placed in THIS user's private folder can be registered.
    this.media.assertOwnedPrivateImage(dto.publicId, userId);
    if (!dto.url.includes(dto.publicId)) {
      throw new AppException(ErrorCode.INVALID_IMAGE_URL, HttpStatus.BAD_REQUEST);
    }
    const created = await this.photos.create({ ...dto, notes: dto.notes ?? '', userId });
    return this.toDto(created.toObject());
  }

  async list(userId: string, query: ProgressPhotoListQueryDto): Promise<ProgressPhotoPageDto> {
    const filter = this.filter(userId, query);
    const [items, total] = await Promise.all([
      this.photos
        .find(filter)
        .sort({ takenAt: -1, _id: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<ProgressPhoto[]>(),
      this.photos.countDocuments(filter),
    ]);
    return {
      items: items.map((p) => this.toDto(p)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  /** Before/after: earliest and latest photo of a view within the range. */
  async compare(userId: string, query: CompareQueryDto): Promise<CompareDto> {
    const filter = this.filter(userId, query);
    const [first] = await this.photos
      .find(filter)
      .sort({ takenAt: 1 })
      .limit(1)
      .lean<ProgressPhoto[]>();
    const [last] = await this.photos
      .find(filter)
      .sort({ takenAt: -1 })
      .limit(1)
      .lean<ProgressPhoto[]>();
    return {
      view: query.view,
      before: first ? this.toDto(first) : null,
      after: last && last._id !== first?._id ? this.toDto(last) : null,
    };
  }

  /**
   * Deletes the Cloudinary asset FIRST, then the record. If Cloudinary fails the record stays,
   * so the user can retry — never an orphaned private photo nobody can find to delete.
   */
  async remove(userId: string, id: string): Promise<void> {
    const photo = await this.photos
      .findOne(notDeleted<ProgressPhoto>({ _id: id, userId }))
      .lean<ProgressPhoto>();
    if (!photo) throw new AppException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    await this.media.destroyPrivateImage(photo.publicId);
    await this.photos.updateOne({ _id: id, userId }, { deletedAt: new Date() });
  }

  private filter(userId: string, query: { view?: PhotoView; from?: Date; to?: Date }): Filter {
    const filter: Filter = notDeleted<ProgressPhoto>({ userId });
    if (query.view) filter.view = query.view;
    if (query.from || query.to) {
      filter.takenAt = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lt: query.to }),
      };
    }
    return filter;
  }

  private toDto(p: ProgressPhoto): ProgressPhotoDto {
    return {
      id: p._id,
      view: p.view,
      takenAt: p.takenAt,
      url: this.media.privateImageUrl(p.publicId, p.format),
      publicId: p.publicId,
      notes: p.notes,
    };
  }
}

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * Creating requires Premium. Listing, comparing and deleting don't: after a downgrade users keep
 * access to (and can delete) their own photos.
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
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.photos.remove(user.id, id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProgressPhoto.name, schema: ProgressPhotoSchema }]),
    MediaModule,
  ],
  controllers: [ProgressPhotosController],
  providers: [ProgressPhotosService],
})
export class ProgressPhotosModule {}
