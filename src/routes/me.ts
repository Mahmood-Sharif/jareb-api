import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import {
  loadCurrentUserProfile,
  updateCurrentUserProfile,
  type JarebProfile,
} from '../services/profile';
import { AppError } from '../errors/app-error';
import type { AppEnv, Bindings } from '../types/app';
import { requireAuth } from '../middleware/auth';

export type LoadProfile = ({
  accessToken,
  bindings,
  userId,
}: {
  accessToken: string;
  bindings: Bindings;
  userId: string;
}) => Promise<JarebProfile | null>;

export type UpdateProfile = ({
  accessToken,
  benefitpayNumber,
  bindings,
  fullName,
  phone,
}: {
  accessToken: string;
  bindings: Bindings;
  fullName: string;
  phone: string;
  benefitpayNumber?: string | null;
}) => Promise<JarebProfile>;

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  benefitpayNumber: z.string().trim().nullable().optional(),
});

export function createMeRoutes({
  authMiddleware = requireAuth,
  loadProfile = loadCurrentUserProfile,
  updateProfile = updateCurrentUserProfile,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  loadProfile?: LoadProfile;
  updateProfile?: UpdateProfile;
} = {}) {
  const meRoutes = new Hono<AppEnv>();

  meRoutes.get('/', authMiddleware, async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const profile = await loadProfile({
      accessToken,
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email ?? null,
        profile,
      },
    });
  });

  meRoutes.patch('/', authMiddleware, async (c) => {
    const body = updateProfileSchema.safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      throw new AppError(400, 'BAD_REQUEST', 'fullName and phone are required.');
    }

    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const profile = await updateProfile({
      accessToken,
      bindings: c.env ?? {},
      fullName: body.data.fullName,
      phone: body.data.phone,
      benefitpayNumber: body.data.benefitpayNumber,
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email ?? null,
        profile,
      },
    });
  });

  return meRoutes;
}

export const meRoutes = createMeRoutes();
