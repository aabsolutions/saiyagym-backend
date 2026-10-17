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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CheckLimit } from '../entitlements/entitlements.decorators';
import { ExerciseQueryDto, TierListQueryDto } from './dto/exercise-query.dto';
import {
  CreateCustomExerciseDto,
  ExerciseDetailDto,
  ExercisePageDto,
  ExercisePrefsDto,
  TierListDto,
  UpdateCustomExerciseDto,
  UpdateExercisePrefsDto,
} from './dto/exercise.dto';
import { ExercisesService } from './exercises.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/** Static paths (`tier-list`) are declared before `:id` so they aren't captured as an id. */
@ApiTags('exercises')
@ApiBearerAuth()
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @ApiOperation({ summary: 'Catalog + own custom exercises, filtered, paginated, localized' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExerciseQueryDto,
    @I18nLang() lang: string,
  ): Promise<ExercisePageDto> {
    return this.exercises.list(user.id, query, lang);
  }

  @Get('tier-list')
  @ApiOperation({ summary: 'Exercises grouped into S/A/B/C for a goal (optionally by muscle)' })
  tierList(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TierListQueryDto,
    @I18nLang() lang: string,
  ): Promise<TierListDto> {
    return this.exercises.tierList(user.id, query, lang);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @I18nLang() lang: string,
  ): Promise<ExerciseDetailDto> {
    return this.exercises.detail(user.id, id, lang);
  }

  @Post()
  @CheckLimit('customExercises')
  @ApiOperation({ summary: 'Create a custom exercise (counts toward the plan limit)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomExerciseDto,
    @I18nLang() lang: string,
  ): Promise<ExerciseDetailDto> {
    return this.exercises.createCustom(user.id, dto, lang);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update one of your custom exercises' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: UpdateCustomExerciseDto,
    @I18nLang() lang: string,
  ): Promise<ExerciseDetailDto> {
    return this.exercises.updateCustom(user.id, id, dto, lang);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete one of your custom exercises (frees a plan slot)' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
  ): Promise<void> {
    await this.exercises.removeCustom(user.id, id);
  }

  @Patch(':id/prefs')
  @ApiOperation({ summary: 'Set favorite and/or personal tier (partial)' })
  updatePrefs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UUID) id: string,
    @Body() dto: UpdateExercisePrefsDto,
  ): Promise<ExercisePrefsDto> {
    return this.exercises.updatePrefs(user.id, id, dto);
  }
}
