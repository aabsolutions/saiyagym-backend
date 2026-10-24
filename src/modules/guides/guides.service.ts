import { Injectable } from '@nestjs/common';
import { localize } from '../../common/utils/translatable.util';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { ExerciseGuidesService } from '../exercises/exercise-guides.service';
import type { ExerciseGuide } from '../exercises/schemas/exercise.schema';
import { MediaService } from '../media/media.service';
import { RoutinesService } from '../routines/routines.service';
import type { ExerciseGuideDto, GuidesDto } from './dto/guide.dto';
import { firstGuided, unlockedByRoutines } from './guide-access';

interface Access {
  limit: number | null;
  guided: Map<string, ExerciseGuide[]>;
  unlocked: Set<string>;
}

/**
 * Who sees which execution guides. Premium (`guidesPerRoutine: null`) sees all; otherwise the
 * first N guided exercises of each routine (programs use routines, so they're covered too).
 * Guide URLs only ever leave the API through here.
 */
@Injectable()
export class GuidesService {
  constructor(
    private readonly exerciseGuides: ExerciseGuidesService,
    private readonly routines: RoutinesService,
    private readonly entitlements: EntitlementsService,
    private readonly media: MediaService,
  ) {}

  async forUser(userId: string, lang: string): Promise<GuidesDto> {
    const access = await this.access(userId);
    return this.toDto(access, [...access.guided.keys()], lang);
  }

  /** A session without a routine: its first N guided exercises are unlocked as well. */
  async resolve(userId: string, exerciseIds: string[], lang: string): Promise<GuidesDto> {
    const access = await this.access(userId);
    for (const id of firstGuided(exerciseIds, new Set(access.guided.keys()), access.limit)) {
      access.unlocked.add(id);
    }
    const requested = new Set(exerciseIds);
    const ids = [...access.guided.keys()].filter((id) => requested.has(id));
    return this.toDto(access, ids, lang);
  }

  private async access(userId: string): Promise<Access> {
    const [{ guidesPerRoutine: limit }, guided] = await Promise.all([
      this.entitlements.getForUser(userId),
      this.exerciseGuides.guidedGlobals(),
    ]);
    const routines = limit === null ? [] : await this.routines.exerciseOrders(userId);
    return { limit, guided, unlocked: unlockedByRoutines(routines, new Set(guided.keys()), limit) };
  }

  private toDto(access: Access, exerciseIds: string[], lang: string): GuidesDto {
    const items: GuidesDto['items'] = [];
    const lockedExerciseIds: string[] = [];
    for (const exerciseId of exerciseIds) {
      if (!access.unlocked.has(exerciseId)) {
        lockedExerciseIds.push(exerciseId);
        continue;
      }
      const guides = access.guided.get(exerciseId) ?? [];
      items.push({ exerciseId, guides: guides.map((g) => this.toGuide(g, lang)) });
    }
    return { guidesPerRoutine: access.limit, items, lockedExerciseIds };
  }

  private toGuide(guide: ExerciseGuide, lang: string): ExerciseGuideDto {
    return {
      id: guide.id,
      kind: guide.kind,
      url: this.media.guideUrl(guide.publicId, guide.format),
      width: guide.width,
      height: guide.height,
      caption: localize(guide.caption, lang),
    };
  }
}
