import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinDate,
  ValidateNested,
} from 'class-validator';
import type { Role } from '../../../common/constants/role';
import { IsOptionalNonNull } from '../../../common/validators/optional-non-null.validator';
import { PlanEntitlementsDto } from '../../plans/dto/plan.dto';
import {
  GOALS,
  LEVELS,
  SEXES,
  SUBSCRIPTION_PROVIDERS,
  SUBSCRIPTION_STATUSES,
  THEMES,
  UNIT_SYSTEMS,
  type Goal,
  type Level,
  type Sex,
  type SubscriptionProvider,
  type SubscriptionStatus,
  type Theme,
  type UnitSystem,
} from '../schemas/user.schema';

export const LANGUAGE_CODE = /^[a-z]{2}(-[A-Z]{2})?$/;

// ---------- Requests ----------

/** Every field is optional; `null` clears it. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string | null;

  @ApiProperty({ type: String, format: 'date', required: false, nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(new Date('1900-01-01'))
  @MaxDate(() => new Date())
  birthDate?: Date | null;

  @IsOptional()
  @IsIn(SEXES)
  sex?: Sex | null;

  /** Centimetres. */
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(272)
  heightCm?: number | null;

  @IsOptional()
  @IsIn(LEVELS)
  level?: Level | null;

  @IsOptional()
  @IsIn(GOALS)
  goal?: Goal | null;
}

/** Every field is optional but none can be `null`. */
export class UpdatePreferencesDto {
  @IsOptionalNonNull()
  @IsIn(UNIT_SYSTEMS)
  units?: UnitSystem;

  @IsOptionalNonNull()
  @Matches(LANGUAGE_CODE)
  language?: string;

  @IsOptionalNonNull()
  @IsIn(THEMES)
  theme?: Theme;

  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(1800)
  defaultRestSeconds?: number;

  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(7)
  firstDayOfWeek?: number;
}

export class UpdateMeDto {
  @IsOptionalNonNull()
  @ValidateNested()
  @Type(() => UpdateProfileDto)
  profile?: UpdateProfileDto;

  @IsOptionalNonNull()
  @ValidateNested()
  @Type(() => UpdatePreferencesDto)
  preferences?: UpdatePreferencesDto;
}

// ---------- Responses ----------

export class ProfileDto {
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: Date, nullable: true }) birthDate!: Date | null;
  @ApiProperty({ enum: SEXES, nullable: true }) sex!: Sex | null;
  @ApiProperty({ type: Number, nullable: true }) heightCm!: number | null;
  @ApiProperty({ enum: LEVELS, nullable: true }) level!: Level | null;
  @ApiProperty({ enum: GOALS, nullable: true }) goal!: Goal | null;
}

export class PreferencesDto {
  @ApiProperty({ enum: UNIT_SYSTEMS }) units!: UnitSystem;
  language!: string;
  @ApiProperty({ enum: THEMES }) theme!: Theme;
  defaultRestSeconds!: number;
  firstDayOfWeek!: number;
}

export class SubscriptionDto {
  @ApiProperty({ type: String, nullable: true }) planId!: string | null;
  @ApiProperty({ enum: SUBSCRIPTION_STATUSES }) status!: SubscriptionStatus;
  @ApiProperty({ type: Date, nullable: true }) currentPeriodEnd!: Date | null;
  @ApiProperty({ enum: SUBSCRIPTION_PROVIDERS }) provider!: SubscriptionProvider;
}

/** The plan that actually applies (may differ from subscription.planId if it expired). */
export class EffectivePlanDto {
  id!: string;
  code!: string;
  name!: string;
  entitlements!: PlanEntitlementsDto;
}

export class MeDto {
  id!: string;
  email!: string;
  role!: Role;
  emailVerified!: boolean;
  profile!: ProfileDto;
  preferences!: PreferencesDto;
  subscription!: SubscriptionDto;
  plan!: EffectivePlanDto;
  createdAt!: Date;
}
