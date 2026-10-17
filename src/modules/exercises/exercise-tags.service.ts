import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import {
  AdminExerciseTagDto,
  CreateExerciseTagDto,
  ExerciseTagDto,
  UpdateExerciseTagDto,
} from './dto/exercise-tag.dto';
import { Exercise } from './schemas/exercise.schema';
import { ExerciseTag, ExerciseTagDocument } from './schemas/exercise-tag.schema';

@Injectable()
export class ExerciseTagsService {
  constructor(
    @InjectModel(ExerciseTag.name) private readonly tags: Model<ExerciseTag>,
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
  ) {}

  async findAll(): Promise<ExerciseTagDocument[]> {
    return this.tags.find(notDeleted<ExerciseTag>()).sort({ slug: 1 });
  }

  /** Throws TAG_NOT_FOUND (400) listing unknown slugs. */
  async assertExist(slugs: string[] | undefined): Promise<void> {
    if (!slugs?.length) return;
    const found = await this.tags.find(notDeleted<ExerciseTag>({ slug: { $in: slugs } }), {
      slug: 1,
    });
    const known = new Set(found.map((tag) => tag.slug));
    const missing = slugs.filter((slug) => !known.has(slug));
    if (missing.length) {
      throw new AppException(ErrorCode.TAG_NOT_FOUND, HttpStatus.BAD_REQUEST, {
        details: { missing },
      });
    }
  }

  async create(dto: CreateExerciseTagDto): Promise<ExerciseTagDocument> {
    // Soft-deleted tags keep their slug, so this also blocks reusing a deleted one.
    if (await this.tags.exists({ slug: dto.slug })) throw slugTaken();
    try {
      return await this.tags.create(dto);
    } catch (error) {
      if ((error as { code?: unknown }).code === 11000) throw slugTaken();
      throw error;
    }
  }

  async update(id: string, dto: UpdateExerciseTagDto): Promise<ExerciseTagDocument> {
    const tag = await this.tags.findOneAndUpdate(
      notDeleted<ExerciseTag>({ _id: id }),
      { name: dto.name },
      { returnDocument: 'after' },
    );
    if (!tag) throw new AppException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    return tag;
  }

  /** Soft delete + removal from every exercise, so filters never hit a dangling tag. */
  async remove(id: string): Promise<void> {
    const tag = await this.tags.findOneAndUpdate(notDeleted<ExerciseTag>({ _id: id }), {
      deletedAt: new Date(),
    });
    if (!tag) throw new AppException(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
    await this.exercises.updateMany({ tags: tag.slug }, { $pull: { tags: tag.slug } });
  }

  toPublic(tag: ExerciseTagDocument, lang: string): ExerciseTagDto {
    return { slug: tag.slug, name: localize(tag.name, lang) };
  }

  toAdmin(tag: ExerciseTagDocument): AdminExerciseTagDto {
    return { id: tag._id, slug: tag.slug, name: tag.name };
  }
}

function slugTaken(): AppException {
  return new AppException(ErrorCode.TAG_SLUG_TAKEN, HttpStatus.CONFLICT);
}
