import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { localize } from '../../common/utils/translatable.util';
import type { Env } from '../../config/env.schema';
import { notDeleted } from '../../database/base.schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { MediaService } from '../media/media.service';
import { createWithFreeSlug } from '../nutrition/nutrition-catalog.helpers';
import { RestSoundRegistry } from '../users/rest-sound.registry';
import {
  AdminRestSoundDto,
  AdminRestSoundPageDto,
  AdminRestSoundQueryDto,
  CreateRestSoundDto,
  RestSoundListDto,
  UpdateRestSoundDto,
} from './dto/rest-sound.dto';
import { RestSound } from './schemas/rest-sound.schema';
import { mp3Url, wavUrl } from './sound-urls';

/**
 * Admin-managed rest-alarm sounds. Premium ones are listed to everybody but `locked` (and without
 * URLs) unless the plan has `premiumSounds`. Soft delete keeps the Cloudinary asset: apps that
 * already cached the file keep playing it.
 */
@Injectable()
export class SoundsService implements OnModuleInit {
  private readonly cloudName: string | undefined;

  constructor(
    @InjectModel(RestSound.name) private readonly sounds: Model<RestSound>,
    private readonly entitlements: EntitlementsService,
    private readonly media: MediaService,
    private readonly registry: RestSoundRegistry,
    config: ConfigService<Env, true>,
  ) {
    this.cloudName = config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
  }

  onModuleInit(): void {
    // Lets UsersService validate `restSoundId` and compute the effective one without importing us.
    this.registry.register(async (id) => {
      const sound = await this.sounds
        .findOne(notDeleted<RestSound>({ _id: id }))
        .select('access')
        .lean<Pick<RestSound, 'access'>>();
      return sound ? { access: sound.access } : null;
    });
  }

  async list(userId: string, lang: string): Promise<RestSoundListDto> {
    const unlocked = await this.entitlements.hasFeature(userId, 'premiumSounds');
    const sounds = await this.sounds
      .find(notDeleted<RestSound>())
      .sort({ sortOrder: 1, slug: 1 })
      .lean<RestSound[]>();
    return {
      items: sounds.map((s) => {
        const locked = s.access === 'premium' && !unlocked;
        return {
          id: s._id,
          slug: s.slug,
          name: localize(s.name, lang),
          access: s.access,
          locked,
          durationSec: s.durationSec,
          wavUrl: locked ? null : this.wav(s.publicId),
          mp3Url: locked ? null : this.mp3(s.publicId),
        };
      }),
    };
  }

  async listAdmin(query: AdminRestSoundQueryDto): Promise<AdminRestSoundPageDto> {
    const filter = notDeleted<RestSound>();
    const [items, total] = await Promise.all([
      this.sounds
        .find(filter)
        .sort({ sortOrder: 1, slug: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<RestSound[]>(),
      this.sounds.countDocuments(filter),
    ]);
    return {
      items: items.map((s) => this.toAdmin(s)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async getAdmin(id: string): Promise<AdminRestSoundDto> {
    return this.toAdmin(await this.require(id));
  }

  /** The asset is verified against Cloudinary first: size, duration and format are never client input. */
  async create(dto: CreateRestSoundDto): Promise<AdminRestSoundDto> {
    const asset = await this.media.verifySoundAsset(dto.publicId);
    const sound = await createWithFreeSlug(
      this.sounds,
      { ...dto, ...asset },
      ErrorCode.SOUND_SLUG_TAKEN,
    );
    return this.toAdmin(sound);
  }

  async update(id: string, dto: UpdateRestSoundDto): Promise<AdminRestSoundDto> {
    const current = await this.require(id);
    const { publicId, ...fields } = dto;
    const replacement =
      publicId !== undefined && publicId !== current.publicId
        ? { publicId, ...(await this.media.verifySoundAsset(publicId)) }
        : {};

    const sound = await this.sounds
      .findOneAndUpdate(
        notDeleted<RestSound>({ _id: id }),
        { ...fields, ...replacement },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<RestSound>();
    if (!sound) throw notFound();
    return this.toAdmin(sound);
  }

  async remove(id: string): Promise<void> {
    const result = await this.sounds.updateOne(notDeleted<RestSound>({ _id: id }), {
      deletedAt: new Date(),
    });
    if (!result.matchedCount) throw notFound();
  }

  private async require(id: string): Promise<RestSound> {
    const sound = await this.sounds.findOne(notDeleted<RestSound>({ _id: id })).lean<RestSound>();
    if (!sound) throw notFound();
    return sound;
  }

  private wav(publicId: string): string | null {
    return this.cloudName ? wavUrl(this.cloudName, publicId) : null;
  }

  private mp3(publicId: string): string | null {
    return this.cloudName ? mp3Url(this.cloudName, publicId) : null;
  }

  private toAdmin(s: RestSound): AdminRestSoundDto {
    return {
      id: s._id,
      slug: s.slug,
      name: s.name,
      access: s.access,
      publicId: s.publicId,
      format: s.format,
      durationSec: s.durationSec,
      bytes: s.bytes,
      sortOrder: s.sortOrder,
      wavUrl: this.wav(s.publicId),
      mp3Url: this.mp3(s.publicId),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}

function notFound(): AppException {
  return new AppException(ErrorCode.SOUND_NOT_FOUND, HttpStatus.NOT_FOUND);
}
