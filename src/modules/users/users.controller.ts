import { Body, Controller, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { Role } from '../../common/constants/role';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  AdminUserDto,
  AdminUserListQueryDto,
  AdminUserPageDto,
  AssignPlanDto,
  ChangeRoleDto,
} from './dto/admin-user.dto';
import { MeDto, UpdateMeDto } from './dto/user.dto';
import { UsersService } from './users.service';

/** Password change and account deletion live in AuthModule (AccountController): they touch sessions. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Current user: profile, preferences and effective plan entitlements' })
  async me(@CurrentUser() current: AuthenticatedUser, @I18nLang() lang: string): Promise<MeDto> {
    const user = await this.users.requireActiveById(current.id);
    return this.users.toMe(user, lang);
  }

  @Patch()
  @ApiOperation({ summary: 'Partial update of profile and/or preferences' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
    @I18nLang() lang: string,
  ): Promise<MeDto> {
    const user = await this.users.updateMe(current.id, dto);
    return this.users.toMe(user, lang);
  }
}

@ApiTags('admin / users')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@Query() query: AdminUserListQueryDto): Promise<AdminUserPageDto> {
    const { items, meta } = await this.users.listForAdmin(query);
    return { items: items.map((user) => this.users.toAdmin(user)), meta };
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<AdminUserDto> {
    return this.users.toAdmin(await this.users.requireActiveById(id));
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: 'Change role. Takes effect on the user’s next token refresh (≤ 15 min).',
  })
  async changeRole(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<AdminUserDto> {
    return this.users.toAdmin(await this.users.changeRole(admin.id, id, dto.role));
  }

  @Put(':id/subscription')
  @ApiOperation({ summary: 'Manually assign a plan (no payment gateway yet)' })
  async assignPlan(@Param('id') id: string, @Body() dto: AssignPlanDto): Promise<AdminUserDto> {
    return this.users.toAdmin(await this.users.assignPlan(id, dto));
  }
}
