import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidTimeZone } from '../utils/local-date.util';

/** IANA time zone, e.g. `America/Argentina/Buenos_Aires`. */
export function IsTimeZone(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimeZone',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidTimeZone(value),
        defaultMessage: () => `${propertyName} must be an IANA time zone`,
      },
    });
}
