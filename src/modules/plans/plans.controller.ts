import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { Role } from '../../common/constants/role';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreatePlanDto, PlanResponseDto, PublicPlanDto, UpdatePlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Public plan catalog (active plans), localized by Accept-Language' })
  async catalog(@I18nLang() lang: string): Promise<PublicPlanDto[]> {
    const plans = await this.plans.findPublicCatalog();
    return plans.map((plan) => this.plans.toPublic(plan, lang));
  }
}

@ApiTags('admin / plans')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  async findAll(): Promise<PlanResponseDto[]> {
    const plans = await this.plans.findAllForAdmin();
    return plans.map((plan) => this.plans.toResponse(plan));
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<PlanResponseDto> {
    return this.plans.toResponse(await this.plans.findById(id));
  }

  @Post()
  async create(@Body() dto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.plans.toResponse(await this.plans.create(dto));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto): Promise<PlanResponseDto> {
    return this.plans.toResponse(await this.plans.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a plan. Its users fall back to the default plan.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.plans.remove(id);
  }
}
