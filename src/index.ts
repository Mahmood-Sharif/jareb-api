import { Hono } from 'hono';

import { AppError, jsonError, toAppError } from './errors/app-error';
import { createRequireAuth, type GetUserFromToken } from './middleware/auth';
import { withCors } from './middleware/cors';
import { createClaimsRoutes } from './routes/claims';
import { createAuthHooksRoutes } from './routes/auth-hooks';
import { createDropsRoutes } from './routes/drops';
import { createMeRoutes, type LoadProfile, type UpdateProfile } from './routes/me';
import { createSavedDropsRoutes } from './routes/saved-drops';
import { createWalletRoutes } from './routes/wallet';
import { healthRoutes } from './routes/health';
import { rewardsService, type RewardsService } from './services/rewards';
import {
  savedDropsService as defaultSavedDropsService,
  type SavedDropsService,
} from './services/saved-drops';
import { walletService as defaultWalletService, type WalletService } from './services/wallet';
import type { AppEnv } from './types/app';

export function createApp({
  deleteAccount,
  getUserFromToken,
  loadProfile,
  updateProfile,
  rewardService = rewardsService,
  savedDropsService = defaultSavedDropsService,
  walletService = defaultWalletService,
  birdSmsClient,
}: {
  birdSmsClient?: import('./integrations/bird/sms').BirdSmsClient;
  deleteAccount?: import('./services/account-deletion').AccountDeletionService['deleteAccount'];
  getUserFromToken?: GetUserFromToken;
  loadProfile?: LoadProfile;
  updateProfile?: UpdateProfile;
  rewardService?: RewardsService;
  savedDropsService?: SavedDropsService;
  walletService?: WalletService;
} = {}) {
  const app = new Hono<AppEnv>();
  const authMiddleware = createRequireAuth(getUserFromToken);

  app.use('*', withCors());

  app.route('/health', healthRoutes);
  app.route('/auth/hooks', createAuthHooksRoutes({ birdSmsClient }));
  app.route('/me', createMeRoutes({ authMiddleware, deleteAccount, loadProfile, updateProfile }));
  app.route('/drops', createDropsRoutes({ authMiddleware, service: rewardService }));
  app.route('/claims', createClaimsRoutes({ authMiddleware, service: rewardService }));
  app.route('/saved-drops', createSavedDropsRoutes({ authMiddleware, service: savedDropsService }));
  app.route('/wallet', createWalletRoutes({ authMiddleware, service: walletService }));

  app.notFound((c) => {
    return jsonError(c, new AppError(404, 'NOT_FOUND', 'Route not found.'));
  });

  app.onError((error, c) => {
    const appError = toAppError(error);

    if (appError.code === 'INTERNAL_SERVER_ERROR' || appError.code === 'INTERNAL_ERROR') {
      console.error(error);
    }

    return jsonError(c, appError);
  });

  return app;
}

export default createApp();
