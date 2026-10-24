import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  CATEGORIES,
  EQUIPMENT,
  MECHANICS,
  MUSCLES,
  TIER_GOALS,
  TIERS,
  type Category,
  type Equipment,
  type Mechanic,
  type Muscle,
  type Tier,
  type TierGoal,
} from '../exercise.constants';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Query strings are strings: only the literal "true" means true. */
const QueryBoolean = () =>
  Transform(({ value }: { value: unknown }) => value === true || value === 'true');

export const EXERCISE_SORTS = ['name', '-name', 'createdAt', '-createdAt', 'relevance'] as const;
export type ExerciseSort = (typeof EXERCISE_SORTS)[number];

export class ExerciseQueryDto extends PaginationQueryDto {
  /** Free text over the exercise name (es + en). Whole words via text index; partial words fall back to substring match. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  /** Primary muscle. */
  @IsOptional()
  @IsIn(MUSCLES)
  muscle?: Muscle;

  @IsOptional()
  @IsIn(EQUIPMENT)
  equipment?: Equipment;

  @IsOptional()
  @IsIn(MECHANICS)
  mechanic?: Mechanic;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: Category;

  /** Required when `tier` is set: tiers are per goal. */
  @ApiProperty({ enum: TIER_GOALS, required: false })
  @ValidateIf((query: ExerciseQueryDto) => query.goal !== undefined || query.tier !== undefined)
  @IsIn(TIER_GOALS)
  goal?: TierGoal;

  /** Global (admin) tier for `goal`. */
  @IsOptional()
  @IsIn(TIERS)
  tier?: Tier;

  @IsOptional()
  @Matches(SLUG_PATTERN)
  tag?: string;

  /** Only the caller's favorites. */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  favorites?: boolean;

  /** Only the caller's custom exercises. */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  custom?: boolean;

  /**
   * Also return the localized `description` and `instructions` of each item (the mobile app
   * downloads the whole catalog with them to work offline). Ignored by the admin listing.
   */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  withText?: boolean;

  /** `relevance` only applies with `q`; otherwise behaves like `name`. */
  @IsOptional()
  @IsIn(EXERCISE_SORTS)
  sort: ExerciseSort = 'name';
}

export const TIER_LIST_SOURCES = ['global', 'personal'] as const;
export type TierListSource = (typeof TIER_LIST_SOURCES)[number];

export class TierListQueryDto {
  @ApiProperty({ enum: TIER_GOALS })
  @IsIn(TIER_GOALS)
  goal!: TierGoal;

  /** Primary muscle. */
  @IsOptional()
  @IsIn(MUSCLES)
  muscle?: Muscle;

  @IsOptional()
  @IsIn(EQUIPMENT)
  equipment?: Equipment;

  /** `personal`: the caller's personal tier wins when set, else the global tier. */
  @IsOptional()
  @IsIn(TIER_LIST_SOURCES)
  source: TierListSource = 'global';
}
