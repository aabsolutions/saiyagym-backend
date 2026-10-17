import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinDate } from 'class-validator';
import { PageMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ROLES, type Role } from '../../../common/constants/role';
import { SubscriptionDto } from './user.dto';

export class AdminUserListQueryDto extends PaginationQueryDto {
  /** Case-insensitive match on email or name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: Role;
}

export class AssignPlanDto {
  @IsUUID()
  planId!: string;

  /** Omit or `null` for no expiry. */
  @ApiProperty({ type: Date, required: false, nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date())
  currentPeriodEnd?: Date | null;
}

export class AdminUserDto {
  id!: string;
  email!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ enum: ROLES }) role!: Role;
  emailVerified!: boolean;
  subscription!: SubscriptionDto;
  createdAt!: Date;
}

export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserDto] }) items!: AdminUserDto[];
  meta!: PageMetaDto;
}
