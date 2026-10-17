import type { Request } from 'express';
import type { Role } from '../constants/role';

/** Claims carried by the access token. Role changes apply on the next refresh (≤ access TTL). */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  /** Session id = refresh-token family id. Lets us revoke "all other sessions". */
  sid: string;
}

export interface AuthenticatedUser {
  id: string;
  role: Role;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
