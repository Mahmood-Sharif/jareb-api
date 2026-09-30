import { Hono } from 'hono';

import { AppError, jsonError, toAppError } from './errors/app-error';
import { createRequireAuth, type GetUserFromToken } from './middleware/auth';
import { withCors } from './middleware/cors';
import { createClaimsRoutes } from './routes/claims';
import { createDropsRoutes } from './routes/drops';
import { createMeRoutes, type LoadProfile, type UpdateProfile } from './routes/me';
import { healthRoutes } from './routes/health';
import { rewardsService, type RewardsService } from './services/rewards';
import type { AppEnv } from './types/app';

export function createApp({
  getUserFromToken,
  loadProfile,
  updateProfile,
  rewardService = rewardsService,
}: {
  getUserFromToken?: GetUserFromToken;
  loadProfile?: LoadProfile;
  updateProfile?: UpdateProfile;
  rewardService?: RewardsService;
} = {}) {
  const app = new Hono<AppEnv>();
  const authMiddleware = createRequireAuth(getUserFromToken);

  app.use('*', withCors());

  app.route('/health', healthRoutes);
  app.route('/me', createMeRoutes({ authMiddleware, loadProfile, updateProfile }));
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
