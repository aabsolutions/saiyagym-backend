import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export interface AppExceptionOptions {
  /** Interpolation args for the translated message, e.g. { limit: 3 } → "máximo {limit}". */
  args?: Record<string, unknown>;
  /** Structured, non-translated extra info returned as `details`. */
  details?: unknown;
  cause?: unknown;
}

/**
 * Domain-level error with a stable `code`. The global filter translates
 * `errors.<code>` using Accept-Language, so services never build user-facing text.
 *
 * @example throw new AppException('ROUTINE_LIMIT_REACHED', HttpStatus.FORBIDDEN, { args: { limit: 3 } })
 */
export class AppException extends HttpException {
  readonly code: ErrorCode | (string & {});
  readonly args?: Record<string, unknown>;
  readonly details?: unknown;

  constructor(
    code: ErrorCode | (string & {}),
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    options: AppExceptionOptions = {},
  ) {
    super(code, status, { cause: options.cause });
    this.code = code;
    this.args = options.args;
    this.details = options.details;
  }
}
