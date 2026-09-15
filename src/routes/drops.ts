import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

import { requireAuth } from '../middleware/auth';
import { rewardsService, type RewardsService } from '../services/rewards';
import type { AppEnv } from '../types/app';

export function createDropsRoutes({
  authMiddleware = requireAuth,
  service = rewardsService,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  service?: Pick<RewardsService, 'listDrops' | 'getDrop' | 'claimDrop'>;
} = {}) {
  const dropsRoutes = new Hono<AppEnv>();

  dropsRoutes.use('*', authMiddleware);

  dropsRoutes.get('/', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const drops = await service.listDrops({
      accessToken,
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json({ drops });
  });

  dropsRoutes.get('/:id', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const drop = await service.getDrop({
      accessToken,
      bindings: c.env ?? {},
      dropId: c.req.param('id'),
      userId: user.id,
    });

    return c.json({ drop });
  });

  dropsRoutes.post('/:id/claim', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const claim = await service.claimDrop({
      accessToken,
      bindings: c.env ?? {},
      dropId: c.req.param('id'),
      userId: user.id,
    });

    return c.json({ claim }, 201);
  });

  return dropsRoutes;
}

export const dropsRoutes = createDropsRoutes();
