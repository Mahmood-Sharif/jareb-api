import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import {
  loadCurrentUserProfile,
  updateCurrentUserProfile,
  type JarebProfile,
} from '../services/profile';
import {
  accountDeletionService,
  type AccountDeletionService,
} from '../services/account-deletion';
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
  privacyVersion,
  termsVersion,
}: {
  accessToken: string;
  bindings: Bindings;
  fullName: string;
  phone?: string | null;
  benefitpayNumber?: string | null;
  privacyVersion?: string | null;
  termsVersion?: string | null;
}) => Promise<JarebProfile>;

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1),
  phone: z.string().trim().min(1).nullable().optional(),
  benefitpayNumber: z.string().trim().nullable().optional(),
  termsVersion: z.string().trim().min(1).nullable().optional(),
  privacyVersion: z.string().trim().min(1).nullable().optional(),
});

export function createMeRoutes({
  authMiddleware = requireAuth,
  deleteAccount = accountDeletionService.deleteAccount,
  loadProfile = loadCurrentUserProfile,
  updateProfile = updateCurrentUserProfile,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  deleteAccount?: AccountDeletionService['deleteAccount'];
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
      throw new AppError(400, 'BAD_REQUEST', 'fullName is required.');
    }

    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const profile = await updateProfile({
      accessToken,
      bindings: c.env ?? {},
      fullName: body.data.fullName,
      phone: body.data.phone,
      benefitpayNumber: body.data.benefitpayNumber,
      termsVersion: body.data.termsVersion,
      privacyVersion: body.data.privacyVersion,
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email ?? null,
        profile,
      },
    });
  });

  meRoutes.delete('/', authMiddleware, async (c) => {
    const user = c.get('authUser');
    const result = await deleteAccount({
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json(result);
  });

  return meRoutes;
}

export const meRoutes = createMeRoutes();
