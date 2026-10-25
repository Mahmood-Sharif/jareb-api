import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { pushNotificationTypes } from '../integrations/firebase/push';
import { requireAuth } from '../middleware/auth';
import {
  pushDeviceService,
  type PushDeviceService,
} from '../services/push-devices';
import { sendPushToUser } from '../services/push-notifications';
import type { AppEnv } from '../types/app';

const registerDeviceSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  platform: z.enum(['android', 'ios', 'web']),
  notificationsEnabled: z.boolean().default(true),
});

const unregisterDeviceSchema = z.object({
  token: z.string().trim().min(1).max(4096),
});

const testPushSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(500).optional(),
    type: z.enum(pushNotificationTypes).default('test'),
    drop_id: z.string().uuid().optional(),
  })
  .strict();

export type PushSender = typeof sendPushToUser;

export function createPushRoutes({
  authMiddleware = requireAuth,
  service = pushDeviceService,
  sendPush = sendPushToUser,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  service?: PushDeviceService;
  sendPush?: PushSender;
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

  routes.post('/test', async (c) => {
    const body = testPushSchema.safeParse(await optionalJson(c.req.raw));
    if (!body.success) {
      throw new AppError(
        400,
        'INVALID_PUSH_DEVICE',
        'Push test request is invalid.',
      );
    }

    const result = await sendPush({
      bindings: c.env ?? {},
      userId: c.get('authUser').id,
      message: {
        title: body.data.title ?? 'Jareb test',
        body: body.data.body ?? 'Push notifications are working.',
        data: {
          type: body.data.type,
          ...(body.data.drop_id ? { drop_id: body.data.drop_id } : {}),
        },
      },
    });

    return c.json({
      tokens_targeted: result.attempted,
      sent: result.delivered,
      failed: result.failed,
      errors: result.errors,
    });
  });

  return routes;
}

async function optionalJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
