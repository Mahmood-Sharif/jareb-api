import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { AppError } from '../errors/app-error';
import { requireAuth } from '../middleware/auth';
import { rewardsService, type RewardsService } from '../services/rewards';
import type { AppEnv } from '../types/app';

const payoutPhoneSchema = z.object({
  payoutPhone: z.string().trim().min(1),
});

const verifyPinSchema = z.object({
  pin: z.string().trim().min(1),
  spendAmount: z.number().finite().positive(),
});

export function createClaimsRoutes({
  authMiddleware = requireAuth,
  service = rewardsService,
}: {
  authMiddleware?: MiddlewareHandler<AppEnv>;
  service?: Pick<
    RewardsService,
    | 'listClaims'
    | 'listActiveClaims'
    | 'getClaim'
    | 'saveClaimPayoutPhone'
    | 'verifyClaimMerchantPin'
  >;
} = {}) {
  const claimsRoutes = new Hono<AppEnv>();

  claimsRoutes.use('*', authMiddleware);

  claimsRoutes.get('/', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const claims = await service.listClaims({
      accessToken,
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json({ claims });
  });

  claimsRoutes.get('/active', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const claims = await service.listActiveClaims({
      accessToken,
      bindings: c.env ?? {},
      userId: user.id,
    });

    return c.json({ claims });
  });

  claimsRoutes.get('/:id', async (c) => {
    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const claim = await service.getClaim({
      accessToken,
      bindings: c.env ?? {},
      claimId: c.req.param('id'),
      userId: user.id,
    });

    return c.json({ claim });
  });

  claimsRoutes.post('/:id/verify-pin', async (c) => {
    const body = verifyPinSchema.safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      throw new AppError(400, 'BAD_REQUEST', 'pin and spendAmount are required.');
    }

    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const claim = await service.verifyClaimMerchantPin({
      accessToken,
      bindings: c.env ?? {},
      claimId: c.req.param('id'),
      pin: body.data.pin,
      spendAmount: body.data.spendAmount,
      userId: user.id,
    });

    return c.json({ claim });
  });

  claimsRoutes.patch('/:id/payout-phone', async (c) => {
    const body = payoutPhoneSchema.safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      throw new AppError(400, 'BAD_REQUEST', 'A payoutPhone value is required.');
    }

    const user = c.get('authUser');
    const accessToken = c.get('authAccessToken');
    const claim = await service.saveClaimPayoutPhone({
      accessToken,
      bindings: c.env ?? {},
      claimId: c.req.param('id'),
      payoutPhone: body.data.payoutPhone,
      userId: user.id,
    });

    return c.json({ claim });
  });

  return claimsRoutes;
}

export const claimsRoutes = createClaimsRoutes();
