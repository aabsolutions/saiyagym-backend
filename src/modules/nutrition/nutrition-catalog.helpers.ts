import { HttpStatus, Injectable } from '@nestjs/common';
import type { Model } from 'mongoose';
import { I18nService } from 'nestjs-i18n';
import { ErrorCode } from '../../common/constants/error-codes';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Inserts a slug-keyed catalog document. Soft-deleted documents keep their slug, so this also
 * blocks reusing a deleted one (same rule as exercises and tags).
 */
export async function createWithFreeSlug<T extends { slug: string }, D extends { slug: string }>(
  model: Model<T>,
  doc: D,
): Promise<T> {
  if (await model.exists({ slug: doc.slug } as never)) throw slugTaken();
  try {
    return await model.create(doc as object);
  } catch (error) {
    if ((error as { code?: unknown }).code === 11000) throw slugTaken();
    throw error;
  }
}

function slugTaken(): AppException {
  return new AppException(ErrorCode.NUTRITION_SLUG_TAKEN, HttpStatus.CONFLICT);
}

/** Collation locale for sorting by a localized name: the language's base code, else `es`. */
export function sortLocale(lang: string): string {
  const base = lang.split('-')[0] ?? '';
  return /^[a-z]{2}$/.test(base) ? base : 'es';
}

/** SPEC: nutrition is general guidance, never medical advice — every user response says so. */
@Injectable()
export class NutritionDisclaimer {
  constructor(private readonly i18n: I18nService) {}

  for(lang: string): string {
    return String(this.i18n.t('nutrition.disclaimer', { lang }));
  }
}
