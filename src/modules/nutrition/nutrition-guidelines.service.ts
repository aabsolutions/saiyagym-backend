import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import {
  AdminGuidelineDto,
  CreateGuidelineDto,
  GuidelineDto,
  GuidelineListDto,
  GuidelineQueryDto,
  UpdateGuidelineDto,
} from './dto/nutrition-guideline.dto';
import { createWithFreeSlug, NutritionDisclaimer } from './nutrition-catalog.helpers';
import { NutritionGuideline } from './schemas/nutrition-guideline.schema';

/** Available on every plan (SPEC: Free gets guidelines and the calculator). Small set: no paging. */
@Injectable()
export class NutritionGuidelinesService {
  constructor(
    @InjectModel(NutritionGuideline.name) private readonly guidelines: Model<NutritionGuideline>,
    private readonly disclaimer: NutritionDisclaimer,
  ) {}

  async list(query: GuidelineQueryDto, lang: string): Promise<GuidelineListDto> {
    const items = await this.find(query);
    return {
      items: items.map((g) => toPublic(g, lang)),
      disclaimer: this.disclaimer.for(lang),
    };
  }

  async detail(id: string, lang: string): Promise<GuidelineDto> {
    return toPublic(await this.require(id), lang);
  }

  async listAdmin(query: GuidelineQueryDto): Promise<AdminGuidelineDto[]> {
    return (await this.find(query)).map(toAdmin);
  }

  async getAdmin(id: string): Promise<AdminGuidelineDto> {
    return toAdmin(await this.require(id));
  }

  async create(dto: CreateGuidelineDto): Promise<AdminGuidelineDto> {
    return toAdmin(await createWithFreeSlug(this.guidelines, dto));
  }

  async update(id: string, dto: UpdateGuidelineDto): Promise<AdminGuidelineDto> {
    const guideline = await this.guidelines
      .findOneAndUpdate(notDeleted<NutritionGuideline>({ _id: id }), dto, {
        returnDocument: 'after',
        runValidators: true,
      })
      .lean<NutritionGuideline>();
    if (!guideline) throw notFound();
    return toAdmin(guideline);
  }

  async remove(id: string): Promise<void> {
    const result = await this.guidelines.updateOne(notDeleted<NutritionGuideline>({ _id: id }), {
      deletedAt: new Date(),
    });
    if (!result.matchedCount) throw notFound();
  }

  private find(query: GuidelineQueryDto): Promise<NutritionGuideline[]> {
    return this.guidelines
      .find(notDeleted<NutritionGuideline>(query.goal ? { goals: query.goal } : {}))
      .sort({ sortOrder: 1, slug: 1 })
      .lean<NutritionGuideline[]>()
      .exec();
  }

  private async require(id: string): Promise<NutritionGuideline> {
    const guideline = await this.guidelines
      .findOne(notDeleted<NutritionGuideline>({ _id: id }))
      .lean<NutritionGuideline>();
    if (!guideline) throw notFound();
    return guideline;
  }
}

function notFound(): AppException {
  return new AppException(ErrorCode.NUTRITION_GUIDELINE_NOT_FOUND, HttpStatus.NOT_FOUND);
}

function toPublic(g: NutritionGuideline, lang: string): GuidelineDto {
  return {
    id: g._id,
    slug: g.slug,
    goals: g.goals,
    title: localize(g.title, lang),
    summary: localize(g.summary, lang),
    body: localize(g.body, lang),
  };
}

function toAdmin(g: NutritionGuideline): AdminGuidelineDto {
  return {
    id: g._id,
    slug: g.slug,
    goals: g.goals,
    title: g.title,
    summary: g.summary,
    body: g.body,
    sortOrder: g.sortOrder,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}
