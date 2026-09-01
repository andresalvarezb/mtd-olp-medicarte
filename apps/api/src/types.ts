import type { Request } from 'express';

/** Reclamos de sesión resueltos por AuthGuard tras validar el JWT local. */
export interface RequestAuth {
  sub: string;
  username: string;
}

export type AuthenticatedRequest = Request & {
  auth: RequestAuth;
  correlationId: string;
};
