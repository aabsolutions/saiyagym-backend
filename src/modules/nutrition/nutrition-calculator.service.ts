import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';
import { BodyMetricsService } from '../body-metrics/body-metrics.service';
import { UsersService } from '../users/users.service';
import { CalculatorRequestDto, CalculatorResponseDto } from './dto/calculator.dto';
import { NutritionDisclaimer } from './nutrition-catalog.helpers';
import { calculateNutrition, resolveCalculatorInput } from './nutrition-calculator';
import { ACTIVITY_FACTORS } from './nutrition.constants';

/** Orientative kcal + macros. Reads the profile, never writes anything. */
@Injectable()
export class NutritionCalculatorService {
  constructor(
    private readonly users: UsersService,
    private readonly bodyMetrics: BodyMetricsService,
    private readonly disclaimer: NutritionDisclaimer,
  ) {}

  async calculate(
    userId: string,
    dto: CalculatorRequestDto,
    lang: string,
  ): Promise<CalculatorResponseDto> {
    const [user, weightKg] = await Promise.all([
      this.users.requireActiveById(userId),
      // Skip the lookup when the request already brings the weight.
      dto.weightKg === undefined ? this.bodyMetrics.latestWeightKg(userId) : null,
    ]);
    const { sex, birthDate, heightCm } = user.profile;
    const resolved = resolveCalculatorInput(
      dto,
      { sex, birthDate, heightCm, weightKg },
      new Date(),
    );
    if (!resolved.ok) {
      throw new AppException(ErrorCode.NUTRITION_PROFILE_INCOMPLETE, HttpStatus.BAD_REQUEST, {
        details: { missing: resolved.missing, outOfRange: resolved.outOfRange },
      });
    }

    const { input, sources } = resolved;
    return {
      formula: 'mifflin_st_jeor',
      input: { ...input, activityFactor: ACTIVITY_FACTORS[input.activityLevel], sources },
      ...calculateNutrition(input),
      disclaimer: this.disclaimer.for(lang),
    };
  }
}
