import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { requireAuth } from '../middleware/auth';
import { sendPushToUser } from '../services/push-notifications';
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
  sendToUser = sendPushToUser,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  service?: PushDeviceService;
  sendToUser?: typeof sendPushToUser;
} = {}) {
  const routes = new Hono<AppEnv>();
  routes.use('*', authMiddleware);

  // Sends a test push to the caller's own devices only. Disabled unless the
  // PUSH_TEST_ENABLED binding is "true" so production stays closed by default.
  routes.post('/test', async (c) => {
    if (c.env?.PUSH_TEST_ENABLED !== 'true') {
      throw new AppError(404, 'NOT_FOUND', 'Not found.');
    }

    const summary = await sendToUser({
      bindings: c.env ?? {},
      userId: c.get('authUser').id,
      message: {
        title: 'Jareb test notification',
        body: 'If you can read this, push notifications work.',
        data: { type: 'drop_live' },
      },
    });
    return c.json(summary);
  });

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
