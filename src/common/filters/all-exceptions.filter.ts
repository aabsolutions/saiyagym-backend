import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { ErrorCode } from '../constants/error-codes';
import { scrubText } from '../utils/log-redaction.util';
import { AppException } from '../exceptions/app.exception';

export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

const FALLBACK_LANG = 'es';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

interface ResolvedError {
  status: number;
  code: string;
  args?: Record<string, unknown>;
  details?: unknown;
}

/**
 * Single exit point for every error: `{ statusCode, code, message, details? }`.
 * `code` is stable; `message` is translated from `errors.<code>` by Accept-Language.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly i18n: I18nService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const resolved = this.resolve(exception);

    if (resolved.status >= 500) {
      if (exception instanceof HttpException) {
        this.logger.warn(`${resolved.status} ${resolved.code}: ${scrubText(exception.message)}`);
      } else {
        // Truly unexpected: full stack server-side, generic INTERNAL_ERROR to the client.
        // Driver messages can embed document values (E11000 … { email: "…" }): scrub them.
        this.logger.error(
          scrubText(exception instanceof Error ? exception.message : String(exception)),
          exception instanceof Error && exception.stack ? scrubText(exception.stack) : undefined,
        );
      }
    }

    const body: ErrorResponseBody = {
      statusCode: resolved.status,
      code: resolved.code,
      message: this.translate(resolved, I18nContext.current(host)?.lang ?? FALLBACK_LANG),
      ...(resolved.details !== undefined && { details: resolved.details }),
    };

    httpAdapter.reply(ctx.getResponse(), body, resolved.status);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        args: exception.args,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: this.codeForStatus(status),
        details: extraResponseDetails(exception.getResponse()),
      };
    }

    if (isMongoDuplicateKeyError(exception)) {
      return { status: HttpStatus.CONFLICT, code: ErrorCode.CONFLICT };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: ErrorCode.INTERNAL_ERROR };
  }

  private codeForStatus(status: number): ErrorCode {
    return (
      CODE_BY_STATUS[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST)
    );
  }

  /** Unknown codes fall back to the generic message for their HTTP status, never to the raw key. */
  private translate({ code, status, args }: ResolvedError, lang: string): string {
    const key = `errors.${code}`;
    const message: unknown = this.i18n.t(key, { lang, args });
    if (typeof message === 'string' && message !== key) return message;

    this.logger.warn(`Missing translation for "${key}" (${lang})`);
    return String(this.i18n.t(`errors.${this.codeForStatus(status)}`, { lang }));
  }
}

/** Nest's default `{ statusCode, message, error }` carries nothing new; anything else
 * (e.g. Terminus' per-indicator health report) is surfaced as `details`. */
function extraResponseDetails(response: string | object): unknown {
  if (typeof response !== 'object') return undefined;
  const defaultKeys = new Set(['statusCode', 'message', 'error']);
  return Object.keys(response).some((key) => !defaultKeys.has(key)) ? response : undefined;
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
