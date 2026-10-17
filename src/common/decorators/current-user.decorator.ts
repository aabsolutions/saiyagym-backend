import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-user';

/** Injects the authenticated user set by JwtAuthGuard. Throws 401 if used on a public route. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new AppException(ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    return user;
  },
);
