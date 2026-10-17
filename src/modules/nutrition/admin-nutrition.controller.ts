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
  AdminFoodDto,
  AdminFoodPageDto,
  CreateFoodDto,
  FoodQueryDto,
  UpdateFoodDto,
} from './dto/food.dto';
import {
  AdminMealSuggestionDto,
  AdminMealSuggestionPageDto,
  CreateMealSuggestionDto,
  MealSuggestionQueryDto,
  UpdateMealSuggestionDto,
} from './dto/meal-suggestion.dto';
import {
  AdminGuidelineDto,
  CreateGuidelineDto,
  GuidelineQueryDto,
  UpdateGuidelineDto,
} from './dto/nutrition-guideline.dto';
import { FoodsService } from './foods.service';
import { MealSuggestionsService } from './meal-suggestions.service';
import { NutritionGuidelinesService } from './nutrition-guidelines.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/** Admin views return raw `{ es, en }` maps. Deletes are soft; slugs stay reserved. */
@ApiTags('admin / nutrition')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/nutrition/foods')
export class AdminFoodsController {
  constructor(private readonly foods: FoodsService) {}

  @Get()
  list(@Query() query: FoodQueryDto): Promise<AdminFoodPageDto> {
    return this.foods.listAdmin(query);
  }

  @Get(':id')
  get(@Param('id', UUID) id: string): Promise<AdminFoodDto> {
    return this.foods.getAdmin(id);
  }

  @Post()
  create(@Body() dto: CreateFoodDto): Promise<AdminFoodDto> {
    return this.foods.create(dto);
  }

  @Patch(':id')
  update(@Param('id', UUID) id: string, @Body() dto: UpdateFoodDto): Promise<AdminFoodDto> {
    return this.foods.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete; 409 FOOD_IN_USE while a meal suggestion uses it' })
  async remove(@Param('id', UUID) id: string): Promise<void> {
    await this.foods.remove(id);
  }
}

@ApiTags('admin / nutrition')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/nutrition/meal-suggestions')
export class AdminMealSuggestionsController {
  constructor(private readonly suggestions: MealSuggestionsService) {}

  @Get()
  list(@Query() query: MealSuggestionQueryDto): Promise<AdminMealSuggestionPageDto> {
    return this.suggestions.listAdmin(query);
  }

  @Get(':id')
  get(@Param('id', UUID) id: string): Promise<AdminMealSuggestionDto> {
    return this.suggestions.getAdmin(id);
  }

  @Post()
  @ApiOperation({ summary: 'Items reference foods by slug (400 FOOD_NOT_FOUND if unknown)' })
  create(@Body() dto: CreateMealSuggestionDto): Promise<AdminMealSuggestionDto> {
    return this.suggestions.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateMealSuggestionDto,
  ): Promise<AdminMealSuggestionDto> {
    return this.suggestions.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', UUID) id: string): Promise<void> {
    await this.suggestions.remove(id);
  }
}

@ApiTags('admin / nutrition')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/nutrition/guidelines')
export class AdminGuidelinesController {
  constructor(private readonly guidelines: NutritionGuidelinesService) {}

  @Get()
  list(@Query() query: GuidelineQueryDto): Promise<AdminGuidelineDto[]> {
    return this.guidelines.listAdmin(query);
  }

  @Get(':id')
  get(@Param('id', UUID) id: string): Promise<AdminGuidelineDto> {
    return this.guidelines.getAdmin(id);
  }

  @Post()
  create(@Body() dto: CreateGuidelineDto): Promise<AdminGuidelineDto> {
    return this.guidelines.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateGuidelineDto,
  ): Promise<AdminGuidelineDto> {
    return this.guidelines.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', UUID) id: string): Promise<void> {
    await this.guidelines.remove(id);
  }
}
