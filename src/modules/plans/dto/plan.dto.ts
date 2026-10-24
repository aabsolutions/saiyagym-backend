import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import type { Entitlements, FeatureKey, LimitKey } from '../plan-entitlements';

/** Required key whose value may be `null` (= unlimited). `undefined` still fails. */
const NullableLimit = () => ValidateIf((_o, value) => value !== null);

export class PlanLimitsDto implements Record<LimitKey, number | null> {
  @ApiProperty({ type: Number, nullable: true, description: 'null = unlimited' })
  @NullableLimit()
  @IsInt()
  @Min(0)
  routines!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'null = unlimited' })
  @NullableLimit()
  @IsInt()
  @Min(0)
  activePrograms!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'null = unlimited' })
  @NullableLimit()
  @IsInt()
  @Min(0)
  customExercises!: number | null;
}

export class PlanFeaturesDto implements Record<FeatureKey, boolean> {
  @IsBoolean() progressPhotos!: boolean;
  @IsBoolean() autoProgression!: boolean;
  @IsBoolean() fullStats!: boolean;
  @IsBoolean() fullNutrition!: boolean;
  @IsBoolean() dataExport!: boolean;
  @IsBoolean() premiumSounds!: boolean;
}

export class PlanEntitlementsDto implements Entitlements {
  @IsDefined()
  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limits!: PlanLimitsDto;

  @ApiProperty({ type: Number, nullable: true, description: 'null = full history' })
  @NullableLimit()
  @IsInt()
  @Min(1)
  @Max(36500)
  statsHistoryDays!: number | null;

  /**
   * Optional on input so clients that predate it keep working: on update, omitted = unchanged;
   * on create, omitted = 0 (no guides). `null` = unlimited.
   */
  @ApiProperty({
    type: Number,
    nullable: true,
    required: false,
    description: 'Exercises per routine with visible guides. null = unlimited',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  guidesPerRoutine!: number | null;

  @IsDefined()
  @ValidateNested()
  @Type(() => PlanFeaturesDto)
  features!: PlanFeaturesDto;
}

export class CreatePlanDto {
  /** Stable machine identifier, e.g. `premium`. Immutable after creation. */
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,31}$/)
  code!: string;

  @ApiProperty({ type: Object, example: { es: 'Premium', en: 'Premium' } })
  @IsTranslatable({ maxLength: 60 })
  name!: Translatable;

  @ApiProperty({ type: Object, required: false, example: { es: '...', en: '...' } })
  @IsOptional()
  @IsTranslatable({ maxLength: 500 })
  description?: Translatable;

  @IsDefined()
  @ValidateNested()
  @Type(() => PlanEntitlementsDto)
  entitlements!: PlanEntitlementsDto;

  /** Setting a plan as default un-sets the previous default. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/**
 * `entitlements`, when sent, replaces the whole object (no deep merge).
 * `skipNullProperties: false`: plain PartialType lets `null` through (→ Mongoose 500 on save).
 */
export class UpdatePlanDto extends PartialType(OmitType(CreatePlanDto, ['code'] as const), {
  skipNullProperties: false,
}) {}

export class PlanResponseDto {
  id!: string;
  code!: string;
  @ApiProperty({ type: Object }) name!: Translatable;
  @ApiProperty({ type: Object }) description!: Translatable;
  entitlements!: PlanEntitlementsDto;
  isDefault!: boolean;
  active!: boolean;
  sortOrder!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Public catalog entry, localized by Accept-Language. */
export class PublicPlanDto {
  id!: string;
  code!: string;
  name!: string;
  description!: string;
  entitlements!: PlanEntitlementsDto;
  isDefault!: boolean;
}
