import { Hono } from 'hono';
import { z } from 'zod';

import { AppError } from '../errors/app-error';
import {
  phoneAccountExists as defaultPhoneAccountExists,
  type PhoneAccountExists,
} from '../services/phone-signup';
import type { AppEnv } from '../types/app';

const eligibilitySchema = z.object({
  phone: z.string().trim().min(1),
});

export function createAuthRoutes({
  phoneAccountExists = defaultPhoneAccountExists,
}: {
  phoneAccountExists?: PhoneAccountExists;
} = {}) {
  const routes = new Hono<AppEnv>();

  routes.post('/phone-signup-eligibility', async (c) => {
    const body = eligibilitySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw new AppError(400, 'BAD_REQUEST', 'A phone number is required.');
    }

    const accountExists = await phoneAccountExists({
      bindings: c.env ?? {},
      phone: body.data.phone,
    });
    return c.json({ accountExists });
  });

  return routes;
}
