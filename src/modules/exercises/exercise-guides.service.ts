import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import { scrubText } from '../../common/utils/log-redaction.util';
import { notDeleted } from '../../database/base.schema';
import { MediaService } from '../media/media.service';
import type { AdminExerciseGuideDto, ReplaceGuidesDto } from './dto/exercise-guide.dto';
import { Exercise, type ExerciseGuide } from './schemas/exercise.schema';

/**
 * Execution guides (images / animated GIFs) of global exercises. Admin writes them here; who may
 * SEE them is decided by the guides module (plan rules), never by the catalog responses.
 */
@Injectable()
export class ExerciseGuidesService {
  private readonly logger = new Logger(ExerciseGuidesService.name);

  constructor(
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
    private readonly media: MediaService,
  ) {}

  /**
   * Replaces the guide list of a live global exercise. New public ids are verified with
   * Cloudinary (bad assets are destroyed and rejected); kept ones only change caption/order.
   * Removed assets are destroyed AFTER the DB write (best-effort): the DB is the truth.
   */
  async replace(exerciseId: string, dto: ReplaceGuidesDto): Promise<void> {
    const exercise = await this.exercises
      .findOne(liveGlobal(exerciseId), { guides: 1 })
      .lean<Pick<Exercise, 'guides'>>();
    if (!exercise) throw notFound();

    const publicIds = dto.guides.map((g) => g.publicId);
    if (new Set(publicIds).size !== publicIds.length) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
        details: [{ field: 'guides', constraints: ['publicId must be unique'] }],
      });
    }

    const current = new Map((exercise.guides ?? []).map((g) => [g.publicId, g]));
    const guides: ExerciseGuide[] = [];
    // Sequential: a failed verification aborts before later uploads are inspected.
    for (const item of dto.guides) {
      const caption = item.caption ?? {};
      const kept = current.get(item.publicId);
      if (kept) {
        guides.push({ ...kept, caption });
        continue;
      }
      const verified = await this.media.verifyGuideAsset(item.publicId);
      guides.push({ id: randomUUID(), publicId: item.publicId, caption, ...verified });
    }

    const result = await this.exercises.updateOne(
      liveGlobal(exerciseId),
      { guides },
      { runValidators: true },
    );
    if (!result.matchedCount) throw notFound();

    const kept = new Set(publicIds);
    for (const old of exercise.guides ?? []) {
      if (!kept.has(old.publicId)) await this.discardAsset(old.publicId);
    }
  }

  /** Live global exercises that have guides, keyed by id (display order kept). */
  async guidedGlobals(): Promise<Map<string, ExerciseGuide[]>> {
    const docs = await this.exercises
      .find(notDeleted<Exercise>({ isGlobal: true, 'guides.0': { $exists: true } }), { guides: 1 })
      .lean<Pick<Exercise, '_id' | 'guides'>[]>();
    return new Map(docs.map((e) => [e._id, e.guides]));
  }

  toAdmin(guide: ExerciseGuide): AdminExerciseGuideDto {
    return {
      id: guide.id,
      kind: guide.kind,
      publicId: guide.publicId,
      format: guide.format,
      width: guide.width,
      height: guide.height,
      bytes: guide.bytes,
      caption: guide.caption ?? {},
      url: this.media.guideUrl(guide.publicId, guide.format),
    };
  }

  /**
   * Destroys an asset no exercise references any more. Soft-deleted exercises count (they keep
   * their guides). Never throws: the DB change already happened.
   */
  private async discardAsset(publicId: string): Promise<void> {
    try {
      if (await this.exercises.exists({ 'guides.publicId': publicId })) return;
      await this.media.destroyGuide(publicId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`guide asset not deleted ${publicId}: ${scrubText(message)}`);
    }
  }
}

function liveGlobal(id: string) {
  return notDeleted<Exercise>({ isGlobal: true, _id: id });
}

function notFound(): AppException {
  return new AppException(ErrorCode.EXERCISE_NOT_FOUND, HttpStatus.NOT_FOUND);
}
