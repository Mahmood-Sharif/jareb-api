import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

import { loadCurrentUserProfile, type JarebProfile } from '../services/profile';
import type { AppEnv, Bindings } from '../types/app';
import { requireAuth } from '../middleware/auth';

export type LoadProfile = ({
  accessToken,
  bindings,
  userId,
}: {
  accessToken: string;
  bindings: Bindings;
  userId: string;
}) => Promise<JarebProfile | null>;

export function createMeRoutes({
  authMiddleware = requireAuth,
  loadProfile = loadCurrentUserProfile,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  loadProfile?: LoadProfile;
} = {}) {
  const meRoutes = new Hono<AppEnv>();

  meRoutes.get('/', authMiddleware, async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const profile = await loadProfile({
      accessToken,
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email ?? null,
        profile,
      },
    });
  });

  return meRoutes;
}

export const meRoutes = createMeRoutes();
