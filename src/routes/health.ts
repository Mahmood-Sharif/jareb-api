import { Hono } from 'hono';

import type { AppEnv } from '../types/app';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'jareb-api',
  });
});
