/** DB content translated per language, e.g. `{ es: 'Sentadilla', en: 'Squat' }`. */
export type Translatable = Record<string, string>;

export const DEFAULT_CONTENT_LANG = 'es';

/**
 * Picks the requested language (`en-US` → `en`), falling back to `es` (SPEC), then to any
 * available value — user-created content is stored untranslated in its author's language.
 */
export function localize(text: Translatable | null | undefined, lang: string): string {
  if (!text) return '';
  const base = lang.split('-')[0] ?? lang;
  return (
    text[lang] ||
    text[base] ||
    text[DEFAULT_CONTENT_LANG] ||
    Object.values(text).find(Boolean) ||
    ''
  );
}
