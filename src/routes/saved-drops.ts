import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';

import { requireAuth } from '../middleware/auth';
import { savedDropsService, type SavedDropsService } from '../services/saved-drops';
import type { AppEnv } from '../types/app';

export function createSavedDropsRoutes({
  authMiddleware = requireAuth,
  service = savedDropsService,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  service?: SavedDropsService;
} = {}) {
  const savedDropsRoutes = new Hono<AppEnv>();

  savedDropsRoutes.use('*', authMiddleware);

  savedDropsRoutes.get('/', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const { savedDrops, serverNow } = await service.listSavedDrops({
      accessToken,
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json({ savedDrops, serverNow });
  });

  savedDropsRoutes.post('/:dropId', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const { savedDrop, serverNow } = await service.saveDrop({
      accessToken,
      bindings: c.env ?? {},
      dropId: c.req.param('dropId'),
      userId: user.id,
    });

    return c.json({ savedDrop, serverNow }, 201);
  });

  savedDropsRoutes.delete('/:dropId', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const result = await service.unsaveDrop({
      accessToken,
      bindings: c.env ?? {},
      dropId: c.req.param('dropId'),
      userId: user.id,
    });

    return c.json(result);
  });

  return savedDropsRoutes;
}
