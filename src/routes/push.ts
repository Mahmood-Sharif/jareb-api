import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { requireAuth } from '../middleware/auth';
import {
  pushDeviceService,
  type PushDeviceService,
} from '../services/push-devices';
import type { AppEnv } from '../types/app';

const registerDeviceSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  platform: z.enum(['android', 'ios', 'web']),
  notificationsEnabled: z.boolean().default(true),
});

const unregisterDeviceSchema = z.object({
  token: z.string().trim().min(1).max(4096),
});

export function createPushRoutes({
  authMiddleware = requireAuth,
  service = pushDeviceService,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  service?: PushDeviceService;
} = {}) {
  const routes = new Hono<AppEnv>();
  routes.use('*', authMiddleware);

  routes.post('/devices', async (c) => {
    const body = registerDeviceSchema.safeParse(await safeJson(c.req.raw));
    if (!body.success) throw invalidDeviceRequest();

    const result = await service.registerDevice({
      bindings: c.env ?? {},
      userId: c.get('authUser').id,
      ...body.data,
    });
    return c.json(result, 201);
  });

  routes.delete('/devices', async (c) => {
    const body = unregisterDeviceSchema.safeParse(await safeJson(c.req.raw));
    if (!body.success) throw invalidDeviceRequest();

    const result = await service.unregisterDevice({
      bindings: c.env ?? {},
      userId: c.get('authUser').id,
      token: body.data.token,
    });
    return c.json(result);
  });

  return routes;
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function invalidDeviceRequest() {
  return new AppError(
    400,
    'INVALID_PUSH_DEVICE',
    'Push device registration is invalid.',
  );
}
