import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { getAllowedOrigins } from './config/env';
import { AppError, jsonError, toAppError } from './errors/app-error';
import { createRequireAuth, type GetUserFromToken } from './middleware/auth';
import { createMeRoutes, type LoadProfile } from './routes/me';
import { healthRoutes } from './routes/health';
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
}: {
  getUserFromToken?: GetUserFromToken;
  loadProfile?: LoadProfile;
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
