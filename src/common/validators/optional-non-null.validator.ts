import { ValidateIf } from 'class-validator';

/**
 * Like @IsOptional() but only skips validation for `undefined`.
 * Use on PATCH fields that may be omitted but must never be cleared with `null`
 * (plain @IsOptional() lets `null` through and would wipe required values).
 */
export const IsOptionalNonNull = () => ValidateIf((_object, value) => value !== undefined);
