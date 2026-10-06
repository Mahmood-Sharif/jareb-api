import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

import { requireAuth } from '../middleware/auth';
import { walletService, type WalletService } from '../services/wallet';
import type { AppEnv } from '../types/app';

export function createWalletRoutes({
  authMiddleware = requireAuth,
  service = walletService,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  service?: WalletService;
} = {}) {
  const walletRoutes = new Hono<AppEnv>();

  walletRoutes.use('*', authMiddleware);

  walletRoutes.get('/', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const response = await service.getWallet({
      accessToken,
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json(response);
  });

  return walletRoutes;
}

export const walletRoutes = createWalletRoutes();
