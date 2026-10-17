import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import { AppException } from '../exceptions/app.exception';
import { flattenValidationErrors } from '../utils/validation-errors.util';

/** Global DTO validation: strips unknown props, rejects them loudly, and coerces types. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppException(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, {
        details: flattenValidationErrors(errors),
      }),
  });
}
