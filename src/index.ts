import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { getAllowedOrigins } from './config/env';
import { AppError, jsonError, toAppError } from './errors/app-error';
import { createRequireAuth, type GetUserFromToken } from './middleware/auth';
import { createClaimsRoutes } from './routes/claims';
import { createDropsRoutes } from './routes/drops';
import { createMeRoutes, type LoadProfile } from './routes/me';
import { healthRoutes } from './routes/health';
import { rewardsService, type RewardsService } from './services/rewards';
import type { AppEnv } from './types/app';

function resolveCorsOrigin(origin: string, allowedOrigins: string[]) {
  if (!origin) {
    return '';
  }

  return allowedOrigins.includes(origin) ? origin : '';
}

export function createApp({
  getUserFromToken,
  loadProfile,
  rewardService = rewardsService,
}: {
  getUserFromToken?: GetUserFromToken;
  loadProfile?: LoadProfile;
  rewardService?: RewardsService;
} = {}) {
  const app = new Hono<AppEnv>();
  const authMiddleware = createRequireAuth(getUserFromToken);

  app.use(
    '*',
    cors({
      origin: (origin, c) => resolveCorsOrigin(origin, getAllowedOrigins(c.env)),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86400,
    }),
  );

  app.route('/health', healthRoutes);
  app.route('/me', createMeRoutes({ authMiddleware, loadProfile }));
  app.route('/drops', createDropsRoutes({ authMiddleware, service: rewardService }));
  app.route('/claims', createClaimsRoutes({ authMiddleware, service: rewardService }));

  app.notFound((c) => {
    return jsonError(c, new AppError(404, 'NOT_FOUND', 'Route not found.'));
  });

  app.onError((error, c) => {
    const appError = toAppError(error);

    if (appError.code === 'INTERNAL_SERVER_ERROR') {
      console.error(error);
    }

    return jsonError(c, appError);
  });

  return app;
}

export default createApp();
