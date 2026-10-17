import { ValidationError } from 'class-validator';

export interface FieldViolation {
  /** Dot path to the offending property, e.g. `exercises.0.sets.2.reps`. */
  field: string;
  /** class-validator constraint names (stable keys clients can map), e.g. ['isInt', 'min']. */
  constraints: string[];
}

/** Flattens class-validator's nested error tree into a list of field violations. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldViolation[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own: FieldViolation[] = error.constraints
      ? [{ field, constraints: Object.keys(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}
