import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientInfo {
  userAgent: string | null;
  ip: string | null;
}

/** User agent + IP of the caller, stored with sessions for "active devices" views and audits.
 * `ip` is only meaningful behind a proxy when TRUST_PROXY is configured. */
export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return {
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
    ip: req.ip ?? null,
  };
});
