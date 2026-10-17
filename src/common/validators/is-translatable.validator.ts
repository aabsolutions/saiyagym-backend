import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { DEFAULT_CONTENT_LANG } from '../utils/translatable.util';

const LANG_KEY = /^[a-z]{2}(-[A-Z]{2})?$/;

/** `{ es: '...', en: '...' }`: language-code keys, non-empty string values, `es` required. */
export function IsTranslatable(options?: { maxLength?: number } & ValidationOptions) {
  const maxLength = options?.maxLength ?? 500;
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isTranslatable',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          return (
            entries.some(([key]) => key === DEFAULT_CONTENT_LANG) &&
            entries.every(
              ([key, text]) =>
                LANG_KEY.test(key) &&
                typeof text === 'string' &&
                text.trim().length > 0 &&
                text.length <= maxLength,
            )
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be { "${DEFAULT_CONTENT_LANG}": string, "<lang>": string, ... } (max ${maxLength} chars each)`;
        },
      },
    });
}
