import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { ErrorCode } from '../../common/constants/error-codes';
import { skipFor } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { escapeRegex } from '../../common/utils/regex.util';
import { localize } from '../../common/utils/translatable.util';
import { notDeleted } from '../../database/base.schema';
import {
  AdminFoodDto,
  AdminFoodPageDto,
  CreateFoodDto,
  FoodDto,
  FoodPageDto,
  FoodQueryDto,
  UpdateFoodDto,
} from './dto/food.dto';
import { createWithFreeSlug, sortLocale } from './nutrition-catalog.helpers';
import { foodSearchText, normalizeSearch } from './nutrition.util';
import { Food } from './schemas/food.schema';
import { MealSuggestion } from './schemas/meal-suggestion.schema';

type Filter = QueryFilter<Food>;

@Injectable()
export class FoodsService {
  constructor(
    @InjectModel(Food.name) private readonly foods: Model<Food>,
    @InjectModel(MealSuggestion.name) private readonly suggestions: Model<MealSuggestion>,
  ) {}

  async list(query: FoodQueryDto, lang: string): Promise<FoodPageDto> {
    const { items, total } = await this.page(query, lang);
    return {
      items: items.map((food) => toPublic(food, lang)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async get(id: string, lang: string): Promise<FoodDto> {
    return toPublic(await this.require(id), lang);
  }

  async listAdmin(query: FoodQueryDto): Promise<AdminFoodPageDto> {
    const { items, total } = await this.page(query, 'es');
    return { items: items.map(toAdmin), meta: { page: query.page, limit: query.limit, total } };
  }

  async getAdmin(id: string): Promise<AdminFoodDto> {
    return toAdmin(await this.require(id));
  }

  async create(dto: CreateFoodDto): Promise<AdminFoodDto> {
    const food = await createWithFreeSlug(this.foods, {
      ...dto,
      tags: dto.tags ?? [],
      searchText: foodSearchText(dto.name),
    });
    return toAdmin(food);
  }

  async update(id: string, dto: UpdateFoodDto): Promise<AdminFoodDto> {
    const food = await this.foods
      .findOneAndUpdate(
        notDeleted<Food>({ _id: id }),
        { ...dto, ...(dto.name && { searchText: foodSearchText(dto.name) }) },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<Food>();
    if (!food) throw notFound();
    return toAdmin(food);
  }

  /** Soft delete. Refused while a live meal suggestion uses it (its totals would silently drop). */
  async remove(id: string): Promise<void> {
    const food = await this.require(id);
    const users = await this.suggestions
      .find(notDeleted<MealSuggestion>({ 'items.foodSlug': food.slug }), { slug: 1 })
      .lean<Pick<MealSuggestion, 'slug'>[]>();
    if (users.length) {
      throw new AppException(ErrorCode.FOOD_IN_USE, HttpStatus.CONFLICT, {
        details: { mealSuggestions: users.map((s) => s.slug) },
      });
    }
    await this.foods.updateOne(notDeleted<Food>({ _id: id }), { deletedAt: new Date() });
  }

  /** Live foods by slug, for resolving meal suggestion items. */
  async findBySlugs(slugs: string[]): Promise<Map<string, Food>> {
    if (!slugs.length) return new Map();
    const found = await this.foods
      .find(notDeleted<Food>({ slug: { $in: [...new Set(slugs)] } }))
      .lean<Food[]>();
    return new Map(found.map((food) => [food.slug, food]));
  }

  /** 400 FOOD_NOT_FOUND listing the unknown (or deleted) slugs. */
  async assertSlugsExist(slugs: string[]): Promise<void> {
    const found = await this.findBySlugs(slugs);
    const missing = [...new Set(slugs)].filter((slug) => !found.has(slug));
    if (missing.length) {
      throw new AppException(ErrorCode.FOOD_NOT_FOUND, HttpStatus.BAD_REQUEST, {
        details: { missing },
      });
    }
  }

  private async page(query: FoodQueryDto, lang: string): Promise<{ items: Food[]; total: number }> {
    const filter: Filter = notDeleted<Food>();
    if (query.category) filter.category = query.category;
    if (query.tag?.length) filter.tags = { $all: query.tag };
    const q = query.q && normalizeSearch(query.q);
    if (q) filter.searchText = { $regex: escapeRegex(q) };

    const locale = sortLocale(lang);
    const [items, total] = await Promise.all([
      this.foods
        .find(filter)
        .collation({ locale, strength: 1 })
        .sort({ [`name.${locale}`]: 1, 'name.es': 1, _id: 1 })
        .skip(skipFor(query))
        .limit(query.limit)
        .lean<Food[]>(),
      this.foods.countDocuments(filter),
    ]);
    return { items, total };
  }

  private async require(id: string): Promise<Food> {
    const food = await this.foods.findOne(notDeleted<Food>({ _id: id })).lean<Food>();
    if (!food) throw notFound();
    return food;
  }
}

function notFound(): AppException {
  return new AppException(ErrorCode.FOOD_NOT_FOUND, HttpStatus.NOT_FOUND);
}

function toPublic(food: Food, lang: string): FoodDto {
  return {
    id: food._id,
    slug: food.slug,
    name: localize(food.name, lang),
    category: food.category,
    per100g: pickMacros(food.per100g),
    tags: food.tags,
  };
}

function toAdmin(food: Food): AdminFoodDto {
  return {
    id: food._id,
    slug: food.slug,
    name: food.name,
    category: food.category,
    per100g: pickMacros(food.per100g),
    tags: food.tags,
    createdAt: food.createdAt,
    updatedAt: food.updatedAt,
  };
}

function pickMacros({ kcal, proteinG, carbsG, fatG }: Food['per100g']): Food['per100g'] {
  return { kcal, proteinG, carbsG, fatG };
}
