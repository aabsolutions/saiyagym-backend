import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import {
  AdminMealSuggestionDto,
  AdminMealSuggestionPageDto,
  CreateMealSuggestionDto,
  MealSuggestionDto,
  MealSuggestionPageDto,
  MealSuggestionQueryDto,
  UpdateMealSuggestionDto,
} from './dto/meal-suggestion.dto';
import { FoodsService } from './foods.service';
import { createWithFreeSlug, NutritionDisclaimer } from './nutrition-catalog.helpers';
import { macrosFor, mealTotals } from './nutrition.util';
import type { Food } from './schemas/food.schema';
import { MealSuggestion } from './schemas/meal-suggestion.schema';

type Filter = QueryFilter<MealSuggestion>;

/**
 * SPEC: full meal suggestions are Premium (`fullNutrition`). Other plans see the admin-chosen
 * samples (`isSample`) plus how many more the filters would unlock.
 */
@Injectable()
export class MealSuggestionsService {
  constructor(
    @InjectModel(MealSuggestion.name) private readonly suggestions: Model<MealSuggestion>,
    private readonly foods: FoodsService,
    private readonly entitlements: EntitlementsService,
    private readonly disclaimer: NutritionDisclaimer,
  ) {}

  async list(
    userId: string,
    query: MealSuggestionQueryDto,
    lang: string,
  ): Promise<MealSuggestionPageDto> {
    const full = await this.entitlements.hasFeature(userId, 'fullNutrition');
    const base = filterFor(query);
    const visible: Filter = full ? base : { ...base, isSample: true };

    const [items, total, lockedCount] = await Promise.all([
      this.suggestions
        .find(visible)
        .sort({ sortOrder: 1, slug: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<MealSuggestion[]>(),
      this.suggestions.countDocuments(visible),
      full ? 0 : this.suggestions.countDocuments({ ...base, isSample: false }),
    ]);
    const foods = await this.foods.findBySlugs(
      items.flatMap((s) => s.items.map((i) => i.foodSlug)),
    );

    return {
      items: items.map((s) => toPublic(s, foods, lang)),
      meta: { page: query.page, limit: query.limit, total },
      limitedByPlan: !full,
      lockedCount,
      disclaimer: this.disclaimer.for(lang),
    };
  }

  /** Non-sample suggestions need `fullNutrition` (403 PLAN_FEATURE_REQUIRED). */
  async detail(userId: string, id: string, lang: string): Promise<MealSuggestionDto> {
    const suggestion = await this.require(id);
    if (!suggestion.isSample) await this.entitlements.assertFeature(userId, 'fullNutrition');
    const foods = await this.foods.findBySlugs(suggestion.items.map((i) => i.foodSlug));
    return toPublic(suggestion, foods, lang);
  }

  async listAdmin(query: MealSuggestionQueryDto): Promise<AdminMealSuggestionPageDto> {
    const filter = filterFor(query);
    const [items, total] = await Promise.all([
      this.suggestions
        .find(filter)
        .sort({ sortOrder: 1, slug: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<MealSuggestion[]>(),
      this.suggestions.countDocuments(filter),
    ]);
    return { items: items.map(toAdmin), meta: { page: query.page, limit: query.limit, total } };
  }

  async getAdmin(id: string): Promise<AdminMealSuggestionDto> {
    return toAdmin(await this.require(id));
  }

  async create(dto: CreateMealSuggestionDto): Promise<AdminMealSuggestionDto> {
    await this.foods.assertSlugsExist(dto.items.map((i) => i.foodSlug));
    return toAdmin(await createWithFreeSlug(this.suggestions, dto));
  }

  async update(id: string, dto: UpdateMealSuggestionDto): Promise<AdminMealSuggestionDto> {
    if (dto.items) await this.foods.assertSlugsExist(dto.items.map((i) => i.foodSlug));
    const suggestion = await this.suggestions
      .findOneAndUpdate(notDeleted<MealSuggestion>({ _id: id }), dto, {
        returnDocument: 'after',
        runValidators: true,
      })
      .lean<MealSuggestion>();
    if (!suggestion) throw notFound();
    return toAdmin(suggestion);
  }

  async remove(id: string): Promise<void> {
    const result = await this.suggestions.updateOne(notDeleted<MealSuggestion>({ _id: id }), {
      deletedAt: new Date(),
    });
    if (!result.matchedCount) throw notFound();
  }

  private async require(id: string): Promise<MealSuggestion> {
    const suggestion = await this.suggestions
      .findOne(notDeleted<MealSuggestion>({ _id: id }))
      .lean<MealSuggestion>();
    if (!suggestion) throw notFound();
    return suggestion;
  }
}

function filterFor(query: MealSuggestionQueryDto): Filter {
  return notDeleted<MealSuggestion>({
    ...(query.goal && { goal: query.goal }),
    ...(query.mealType && { mealType: query.mealType }),
  });
}

function notFound(): AppException {
  return new AppException(ErrorCode.MEAL_SUGGESTION_NOT_FOUND, HttpStatus.NOT_FOUND);
}

function toPublic(s: MealSuggestion, foods: Map<string, Food>, lang: string): MealSuggestionDto {
  const items = s.items.flatMap((item) => {
    const food = foods.get(item.foodSlug);
    if (!food) return [];
    return [
      {
        foodId: food._id,
        foodSlug: food.slug,
        name: localize(food.name, lang),
        grams: item.grams,
        ...macrosFor(food.per100g, item.grams),
      },
    ];
  });
  const per100g = new Map([...foods].map(([slug, food]) => [slug, food.per100g]));
  return {
    id: s._id,
    slug: s.slug,
    name: localize(s.name, lang),
    description: localize(s.description, lang),
    goal: s.goal,
    mealType: s.mealType,
    items,
    totals: mealTotals(s.items, per100g),
    isSample: s.isSample,
  };
}

function toAdmin(s: MealSuggestion): AdminMealSuggestionDto {
  return {
    id: s._id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    goal: s.goal,
    mealType: s.mealType,
    items: s.items.map(({ foodSlug, grams }) => ({ foodSlug, grams })),
    isSample: s.isSample,
    sortOrder: s.sortOrder,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
