import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { Role } from '../../common/constants/role';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReplaceGuidesDto } from './dto/exercise-guide.dto';
import { ExerciseQueryDto } from './dto/exercise-query.dto';
import {
  AdminExerciseTagDto,
  CreateExerciseTagDto,
  ExerciseTagDto,
  UpdateExerciseTagDto,
} from './dto/exercise-tag.dto';
import {
  AdminExerciseDto,
  AdminExercisePageDto,
  BulkTiersDto,
  BulkTiersResultDto,
  CreateGlobalExerciseDto,
  UpdateGlobalExerciseDto,
} from './dto/exercise.dto';
import { ExerciseGuidesService } from './exercise-guides.service';
import { ExerciseTagsService } from './exercise-tags.service';
import { ExercisesService } from './exercises.service';

const UUID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin / exercises')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/exercises')
export class AdminExercisesController {
  constructor(
    private readonly exercises: ExercisesService,
    private readonly guides: ExerciseGuidesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Global catalog with full translation maps (favorites/custom filters ignored)',
  })
  list(@Query() query: ExerciseQueryDto): Promise<AdminExercisePageDto> {
    return this.exercises.listGlobal(query);
  }

  /** Declared before `:id` routes. */
  @Patch('tiers')
  @ApiOperation({ summary: 'Bulk tier assignment. Omitted goal = unchanged, null = unranked.' })
  bulkTiers(@Body() dto: BulkTiersDto): Promise<BulkTiersResultDto> {
    return this.exercises.bulkUpdateTiers(dto);
  }

  @Get(':id')
  findOne(@Param('id', UUID) id: string): Promise<AdminExerciseDto> {
    return this.exercises.findGlobal(id);
  }

  @Post()
  create(@Body() dto: CreateGlobalExerciseDto): Promise<AdminExerciseDto> {
    return this.exercises.createGlobal(dto);
  }

  @Patch(':id')
  update(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateGlobalExerciseDto,
  ): Promise<AdminExerciseDto> {
    return this.exercises.updateGlobal(id, dto);
  }

  @Put(':id/guides')
  @ApiOperation({
    summary: 'Replace the execution guides (images / GIFs) of a global exercise',
    description:
      'Upload each file with an `exercise_guide` signature first, then send its `public_id`. ' +
      'Array order = display order; `[]` removes all. New files are verified with Cloudinary ' +
      '(400 INVALID_GUIDE_ASSET destroys them); removed files are destroyed after saving.',
  })
  async replaceGuides(
    @Param('id', UUID) id: string,
    @Body() dto: ReplaceGuidesDto,
  ): Promise<AdminExerciseDto> {
    await this.guides.replace(id, dto);
    return this.exercises.findGlobal(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete. The slug stays reserved.' })
  async remove(@Param('id', UUID) id: string): Promise<void> {
    await this.exercises.removeGlobal(id);
  }
}

@ApiTags('exercises')
@Controller('exercise-tags')
export class ExerciseTagsController {
  constructor(private readonly tags: ExerciseTagsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'All tags, localized by Accept-Language' })
  async list(@I18nLang() lang: string): Promise<ExerciseTagDto[]> {
    return (await this.tags.findAll()).map((tag) => this.tags.toPublic(tag, lang));
  }
}

@ApiTags('admin / exercises')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/exercise-tags')
export class AdminExerciseTagsController {
  constructor(private readonly tags: ExerciseTagsService) {}

  @Get()
  async list(): Promise<AdminExerciseTagDto[]> {
    return (await this.tags.findAll()).map((tag) => this.tags.toAdmin(tag));
  }

  @Post()
  async create(@Body() dto: CreateExerciseTagDto): Promise<AdminExerciseTagDto> {
    return this.tags.toAdmin(await this.tags.create(dto));
  }

  @Patch(':id')
  async update(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateExerciseTagDto,
  ): Promise<AdminExerciseTagDto> {
    return this.tags.toAdmin(await this.tags.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete; the tag is removed from every exercise' })
  async remove(@Param('id', UUID) id: string): Promise<void> {
    await this.tags.remove(id);
  }
}
