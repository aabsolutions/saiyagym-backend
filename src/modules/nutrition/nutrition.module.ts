import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BodyMetricsModule } from '../body-metrics/body-metrics.module';
import { UsersModule } from '../users/users.module';
import {
  AdminFoodsController,
  AdminGuidelinesController,
  AdminMealSuggestionsController,
} from './admin-nutrition.controller';
import { FoodsService } from './foods.service';
import { MealSuggestionsService } from './meal-suggestions.service';
import { NutritionCalculatorService } from './nutrition-calculator.service';
import { NutritionDisclaimer } from './nutrition-catalog.helpers';
import { NutritionController } from './nutrition.controller';
import { NutritionGuidelinesService } from './nutrition-guidelines.service';
import { NutritionSeeder } from './nutrition.seeder';
import { Food, FoodSchema } from './schemas/food.schema';
import { MealSuggestion, MealSuggestionSchema } from './schemas/meal-suggestion.schema';
import { NutritionGuideline, NutritionGuidelineSchema } from './schemas/nutrition-guideline.schema';

/** Static, admin-managed nutrition content + orientative calculator. No daily food logging. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Food.name, schema: FoodSchema },
      { name: MealSuggestion.name, schema: MealSuggestionSchema },
      { name: NutritionGuideline.name, schema: NutritionGuidelineSchema },
    ]),
    UsersModule,
    BodyMetricsModule,
  ],
  controllers: [
    NutritionController,
    AdminFoodsController,
    AdminMealSuggestionsController,
    AdminGuidelinesController,
  ],
  providers: [
    FoodsService,
    MealSuggestionsService,
    NutritionGuidelinesService,
    NutritionCalculatorService,
    NutritionDisclaimer,
    NutritionSeeder,
  ],
  exports: [NutritionSeeder],
})
export class NutritionModule {}
