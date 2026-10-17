import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DELOAD_MODES,
  PROGRESSION_TYPES,
  type DeloadConfig,
  type DeloadMode,
  type DoubleProgressionRule,
  type PercentOf1RMRule,
  type ProgressionType,
  type WeekPercent,
} from '../../../common/constants/training';

export class DeloadConfigDto implements DeloadConfig {
  @ApiProperty({ enum: DELOAD_MODES })
  @IsIn(DELOAD_MODES)
  mode!: DeloadMode;

  /** % to remove from weight or from the number of working sets. */
  @IsNumber()
  @Min(5)
  @Max(90)
  percent!: number;
}

/** Base for the discriminated union; also catches unknown `type` values. */
export class ProgressionRuleBaseDto {
  @ApiProperty({ enum: PROGRESSION_TYPES })
  @IsIn(PROGRESSION_TYPES)
  type!: ProgressionType;

  /** Plate rounding; defaults to 2.5 kg (compound) / 1 kg (isolation). */
  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(10)
  roundingKg?: number | null;

  /** Overrides the program's deload config for this exercise. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DeloadConfigDto)
  deload?: DeloadConfigDto | null;
}

export class DoubleProgressionRuleDto
  extends ProgressionRuleBaseDto
  implements DoubleProgressionRule
{
  @ApiProperty({ enum: ['double_progression'] })
  declare type: 'double_progression';

  /** Defaults to 2.5 kg (compound) / 1 kg (isolation). */
  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(20)
  incrementKg?: number | null;
}

export class WeekPercentDto implements WeekPercent {
  @IsNumber()
  @Min(30)
  @Max(110)
  percent!: number;

  /** Overrides the routine's reps (repsMin = repsMax) that week. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  reps?: number | null;

  /** Overrides the number of working sets that week. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  sets?: number | null;
}

export class PercentOf1RMRuleDto extends ProgressionRuleBaseDto implements PercentOf1RMRule {
  @ApiProperty({ enum: ['percent_1rm'] })
  declare type: 'percent_1rm';

  /** One entry per week; cycled if the program is longer. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(52)
  @ValidateNested({ each: true })
  @Type(() => WeekPercentDto)
  weeks!: WeekPercentDto[];
}

/** class-transformer picks the concrete class from `type`; unknown types fail on the base's @IsIn. */
export const progressionRuleType = () =>
  Type(() => ProgressionRuleBaseDto, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'type',
      subTypes: [
        { value: DoubleProgressionRuleDto, name: 'double_progression' },
        { value: PercentOf1RMRuleDto, name: 'percent_1rm' },
      ],
    },
  });
