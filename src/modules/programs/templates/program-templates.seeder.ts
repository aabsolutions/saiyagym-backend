import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Model } from 'mongoose';
import { flattenValidationErrors } from '../../../common/utils/validation-errors.util';
import { CreateProgramTemplateDto } from './program-template.dto';
import { ProgramTemplate } from './program-template.schema';
import { fromDto, ProgramTemplatesService } from './program-templates.service';

export const TEMPLATES_SEED_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'database',
  'seeds',
  'program-templates.seed.json',
);

export function loadTemplatesSeed(path = TEMPLATES_SEED_PATH): unknown[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as { templates: unknown[] }).templates;
}

/**
 * Same validation as the admin API (DTO + structural + exercise slugs exist), so the global
 * exercises must be seeded first. Insert-only by default; `update` overwrites live templates.
 * Soft-deleted templates keep their slug and are never resurrected.
 */
@Injectable()
export class ProgramTemplatesSeeder {
  private readonly logger = new Logger(ProgramTemplatesSeeder.name);

  constructor(
    @InjectModel(ProgramTemplate.name) private readonly templates: Model<ProgramTemplate>,
    private readonly service: ProgramTemplatesService,
  ) {}

  async run(raw: unknown[], options: { update: boolean }) {
    const report = { inserted: 0, updated: 0, skipped: 0 };

    for (const [index, item] of raw.entries()) {
      const dto = plainToInstance(CreateProgramTemplateDto, item);
      const errors = flattenValidationErrors(
        await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
      );
      if (errors.length)
        throw new Error(`Template #${index} (${dto.slug}): ${JSON.stringify(errors)}`);

      const content = fromDto(dto);
      try {
        await this.service.validate(content);
      } catch (error) {
        throw new Error(
          `Template ${dto.slug}: ${JSON.stringify((error as { details?: unknown }).details ?? error)}`,
          { cause: error },
        );
      }

      const doc = {
        ...content,
        slug: dto.slug,
        name: dto.name,
        description: dto.description ?? {},
        goal: dto.goal,
        level: dto.level,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? index,
      };
      const existing = await this.templates
        .findOne({ slug: dto.slug }, { deletedAt: 1 })
        .lean<ProgramTemplate>();
      if (!existing) {
        await this.templates.create(doc);
        report.inserted++;
      } else if (options.update && !existing.deletedAt) {
        await this.templates.updateOne({ slug: dto.slug }, { $set: doc });
        report.updated++;
      } else {
        report.skipped++;
      }
    }
    this.logger.log(`Program templates ${JSON.stringify(report)}`);
    return report;
  }
}
