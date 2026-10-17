import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CalculatorRequestDto, CalculatorResponseDto } from './dto/calculator.dto';
import { FoodDto, FoodPageDto, FoodQueryDto } from './dto/food.dto';
import {
  MealSuggestionDto,
  MealSuggestionPageDto,
  MealSuggestionQueryDto,
} from './dto/meal-suggestion.dto';
import { GuidelineDto, GuidelineListDto, GuidelineQueryDto } from './dto/nutrition-guideline.dto';
import { FoodsService } from './foods.service';
import { MealSuggestionsService } from './meal-suggestions.service';
import { NutritionCalculatorService } from './nutrition-calculator.service';
import { NutritionGuidelinesService } from './nutrition-guidelines.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/** General suggestions, NOT medical advice (SPEC). Responses are localized by Accept-Language. */
@ApiTags('nutrition')
@ApiBearerAuth()
@Controller('nutrition')
export class NutritionController {
  constructor(
    private readonly foods: FoodsService,
    private readonly suggestions: MealSuggestionsService,
    private readonly guidelines: NutritionGuidelinesService,
    private readonly calculator: NutritionCalculatorService,
  ) {}

  @Get('foods')
  @ApiOperation({ summary: 'Food database (macros per 100 g), filter by category, tags and text' })
  listFoods(@Query() query: FoodQueryDto, @I18nLang() lang: string): Promise<FoodPageDto> {
    return this.foods.list(query, lang);
  }

  @Get('foods/:id')
  getFood(@Param('id', UUID) id: string, @I18nLang() lang: string): Promise<FoodDto> {
    return this.foods.get(id, lang);
  }

  @Get('meal-suggestions')
  @ApiOperation({
    summary: 'Meal suggestions by goal and meal type. Without fullNutrition: samples only.',
  })
  listSuggestions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MealSuggestionQueryDto,
    @I18nLang() lang: string,
  ): Promise<MealSuggestionPageDto> {
    return this.suggestions.list(user.id, query, lang);
  }

  @Get('meal-suggestions/:id')
  @ApiOperation({ summary: 'One suggestion; non-sample ones require fullNutrition (403)' })
  getSuggestion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @I18nLang() lang: string,
  ): Promise<MealSuggestionDto> {
    return this.suggestions.detail(user.id, id, lang);
  }

  @Get('guidelines')
  @ApiOperation({ summary: 'Short guidelines (protein, hydration, timing…), every plan' })
  listGuidelines(
    @Query() query: GuidelineQueryDto,
    @I18nLang() lang: string,
  ): Promise<GuidelineListDto> {
    return this.guidelines.list(query, lang);
  }

  @Get('guidelines/:id')
  getGuideline(@Param('id', UUID) id: string, @I18nLang() lang: string): Promise<GuidelineDto> {
    return this.guidelines.detail(id, lang);
  }

  @Post('calculator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Orientative kcal (Mifflin-St Jeor × activity) and macros for a goal. Missing fields come ' +
      'from the profile / latest weight. Stores nothing; always returns a disclaimer.',
  })
  calculate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CalculatorRequestDto,
    @I18nLang() lang: string,
  ): Promise<CalculatorResponseDto> {
    return this.calculator.calculate(user.id, dto, lang);
  }
}
