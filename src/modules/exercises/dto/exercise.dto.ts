import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageMetaDto } from '../../../common/dto/pagination.dto';
import type { Translatable } from '../../../common/utils/translatable.util';
import { IsTranslatable } from '../../../common/validators/is-translatable.validator';
import { IsOptionalNonNull } from '../../../common/validators/optional-non-null.validator';
import {
  CATEGORIES,
  EQUIPMENT,
  MECHANICS,
  MUSCLES,
  TIERS,
  TRACKING_TYPES,
  type Category,
  type Equipment,
  type Mechanic,
  type Muscle,
  type Tier,
  type Tiers,
  type TrackingType,
} from '../exercise.constants';
import { SLUG_PATTERN } from './exercise-query.dto';

/** Nullable but required key: `null` = not ranked for that goal. */
const NullableTier = () => ValidateIf((_o, value) => value !== null);

export class TiersDto implements Tiers {
  @ApiProperty({ enum: TIERS, nullable: true })
  @NullableTier()
  @IsIn(TIERS)
  hypertrophy!: Tier | null;

  @ApiProperty({ enum: TIERS, nullable: true })
  @NullableTier()
  @IsIn(TIERS)
  powerlifting!: Tier | null;
}

/** Fields shared by custom (user) and global (admin) exercises. */
class ExerciseBodyDto {
  @ApiProperty({ enum: MUSCLES })
  @IsIn(MUSCLES)
  primaryMuscle!: Muscle;

  @ApiProperty({ enum: MUSCLES, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsIn(MUSCLES, { each: true })
  secondaryMuscles?: Muscle[];

  @ApiProperty({ enum: EQUIPMENT })
  @IsIn(EQUIPMENT)
  equipment!: Equipment;

  @ApiProperty({ enum: MECHANICS })
  @IsIn(MECHANICS)
  mechanic!: Mechanic;

  @ApiProperty({ enum: CATEGORIES, required: false })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: Category;

  /** Tag slugs; each must exist (GET /exercise-tags). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(SLUG_PATTERN, { each: true })
  tags?: string[];

  /** Must be a Cloudinary URL obtained via POST /media/upload-signature. `null` removes it. */
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string | null;
}

// ---------- Custom exercises (user) ----------

/** User content is not translated: stored as written, shown as written in every language. */
export class CreateCustomExerciseDto extends ExerciseBodyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;
}

/**
 * Written out instead of PartialType(...): PartialType adds @IsOptional(), which also lets
 * `null` through — `{ "name": null }` would wipe a required field. Here only `undefined` skips
 * validation; `null` is accepted solely where it means "clear" (description, instructions, imageUrl).
 */
export class UpdateCustomExerciseDto {
  @IsOptionalNonNull()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string | null;

  @ApiProperty({ enum: MUSCLES, required: false })
  @IsOptionalNonNull()
  @IsIn(MUSCLES)
  primaryMuscle?: Muscle;

  @ApiProperty({ enum: MUSCLES, isArray: true, required: false })
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsIn(MUSCLES, { each: true })
  secondaryMuscles?: Muscle[];

  @ApiProperty({ enum: EQUIPMENT, required: false })
  @IsOptionalNonNull()
  @IsIn(EQUIPMENT)
  equipment?: Equipment;

  @ApiProperty({ enum: MECHANICS, required: false })
  @IsOptionalNonNull()
  @IsIn(MECHANICS)
  mechanic?: Mechanic;

  @ApiProperty({ enum: CATEGORIES, required: false })
  @IsOptionalNonNull()
  @IsIn(CATEGORIES)
  category?: Category;

  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @Matches(SLUG_PATTERN, { each: true })
  tags?: string[];

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string | null;
}

// ---------- Global exercises (admin) ----------

export class CreateGlobalExerciseDto extends ExerciseBodyDto {
  /** Stable id, e.g. `barbell-back-squat`. Immutable. */
  @Matches(SLUG_PATTERN)
  @MaxLength(80)
  slug!: string;

  @ApiProperty({ type: Object, example: { es: 'Sentadilla trasera', en: 'Back squat' } })
  @IsTranslatable({ maxLength: 80 })
  name!: Translatable;

  @ApiProperty({ type: Object, required: false })
  @IsOptional()
  @IsTranslatable({ maxLength: 2000 })
  description?: Translatable;

  @ApiProperty({ type: Object, required: false })
  @IsOptional()
  @IsTranslatable({ maxLength: 4000 })
  instructions?: Translatable;

  @IsDefined()
  @ValidateNested()
  @Type(() => TiersDto)
  tiers!: TiersDto;
}

/** `skipNullProperties: false`: omitted = unchanged, `null` = rejected (except imageUrl → remove). */
export class UpdateGlobalExerciseDto extends PartialType(
  OmitType(CreateGlobalExerciseDto, ['slug', 'imageUrl'] as const),
  { skipNullProperties: false },
) {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string | null;
}

export class BulkTierItemDto {
  @IsUUID()
  id!: string;

  /** Omit to leave unchanged; `null` to unrank. */
  @ApiProperty({ enum: TIERS, nullable: true, required: false })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsIn(TIERS)
  hypertrophy?: Tier | null;

  @ApiProperty({ enum: TIERS, nullable: true, required: false })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsIn(TIERS)
  powerlifting?: Tier | null;
}

export class BulkTiersDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkTierItemDto)
  items!: BulkTierItemDto[];
}

export class BulkTiersResultDto {
  updated!: number;
  /** Ids that don't exist, are deleted or aren't global. */
  notFound!: string[];
}

// ---------- Preferences ----------

/** Partial, per goal: omit a goal to leave it unchanged; `null` clears it (→ global tier). */
export class PersonalTiersPatchDto {
  @ApiProperty({ enum: TIERS, nullable: true, required: false })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsIn(TIERS)
  hypertrophy?: Tier | null;

  @ApiProperty({ enum: TIERS, nullable: true, required: false })
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsIn(TIERS)
  powerlifting?: Tier | null;
}

export class UpdateExercisePrefsDto {
  @IsOptionalNonNull()
  @IsBoolean()
  isFavorite?: boolean;

  /** Personal tier per goal, like the global `tiers`. Only the sent goals change. */
  @ApiProperty({ type: PersonalTiersPatchDto, required: false })
  @IsOptionalNonNull()
  @ValidateNested()
  @Type(() => PersonalTiersPatchDto)
  personalTiers?: PersonalTiersPatchDto;
}

/** Sync payload for user_exercise_prefs (full state of the pref for one exercise). */
export class SyncExercisePrefDto extends UpdateExercisePrefsDto {
  @IsUUID('4')
  exerciseId!: string;
}

export class ExercisePrefsDto {
  exerciseId!: string;
  isFavorite!: boolean;
  /** `null` for a goal = no personal tier there (the global one applies). */
  personalTiers!: TiersDto;
}

// ---------- Responses ----------

/** Localized view for users: name/description resolved by Accept-Language (fallback es). */
export class ExerciseSummaryDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true }) slug!: string | null;
  name!: string;
  @ApiProperty({ enum: MUSCLES }) primaryMuscle!: Muscle;
  @ApiProperty({ enum: MUSCLES, isArray: true }) secondaryMuscles!: Muscle[];
  @ApiProperty({ enum: EQUIPMENT }) equipment!: Equipment;
  @ApiProperty({ enum: MECHANICS }) mechanic!: Mechanic;
  @ApiProperty({ enum: CATEGORIES }) category!: Category;
  @ApiProperty({ enum: TRACKING_TYPES }) trackingType!: TrackingType;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  tags!: string[];
  tiers!: TiersDto;
  isGlobal!: boolean;
  /** Created by the caller. */
  isCustom!: boolean;
  isFavorite!: boolean;
  /** The caller's own tier per goal; `null` = none (the global tier applies). */
  personalTiers!: TiersDto;
}

export class ExerciseDetailDto extends ExerciseSummaryDto {
  description!: string;
  instructions!: string;
}

export class ExercisePageDto {
  @ApiProperty({ type: [ExerciseSummaryDto] }) items!: ExerciseSummaryDto[];
  meta!: PageMetaDto;
}

export class TierListDto {
  @ApiProperty({ enum: ['hypertrophy', 'powerlifting'] }) goal!: string;
  @ApiProperty({ type: String, nullable: true }) muscle!: string | null;
  @ApiProperty({ enum: ['global', 'personal'] }) source!: string;
  /** Columns in S → C order; within a column, sorted by localized name. */
  @ApiProperty({
    type: 'object',
    properties: Object.fromEntries(
      TIERS.map((tier) => [
        tier,
        { type: 'array', items: { $ref: '#/components/schemas/ExerciseSummaryDto' } },
      ]),
    ),
  })
  tiers!: Record<Tier, ExerciseSummaryDto[]>;
  /** No tier for this goal (e.g. custom exercises). */
  @ApiProperty({ type: [ExerciseSummaryDto] }) unranked!: ExerciseSummaryDto[];
}

/** Admin view: full translation maps, no per-user overlay. */
export class AdminExerciseDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true }) slug!: string | null;
  @ApiProperty({ type: Object }) name!: Translatable;
  @ApiProperty({ type: Object }) description!: Translatable;
  @ApiProperty({ type: Object }) instructions!: Translatable;
  @ApiProperty({ enum: MUSCLES }) primaryMuscle!: Muscle;
  @ApiProperty({ enum: MUSCLES, isArray: true }) secondaryMuscles!: Muscle[];
  @ApiProperty({ enum: EQUIPMENT }) equipment!: Equipment;
  @ApiProperty({ enum: MECHANICS }) mechanic!: Mechanic;
  @ApiProperty({ enum: CATEGORIES }) category!: Category;
  @ApiProperty({ enum: TRACKING_TYPES }) trackingType!: TrackingType;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  tags!: string[];
  tiers!: TiersDto;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AdminExercisePageDto {
  @ApiProperty({ type: [AdminExerciseDto] }) items!: AdminExerciseDto[];
  meta!: PageMetaDto;
}

/** Path param guard so malformed ids 404 instead of reaching Mongo. */
export class ExerciseIdParamDto {
  @IsUUID()
  id!: string;
}
