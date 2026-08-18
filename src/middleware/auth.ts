import { createMiddleware } from 'hono/factory';
import type { User } from '@supabase/supabase-js';

import { getSupabaseAuthConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import { createSupabaseUserClient } from '../services/supabase';
import type { Bindings } from '../types/app';
import type { AppEnv } from '../types/app';

export function getBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const parts = authorizationHeader.trim().split(/\s+/);

  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export type GetUserFromToken = ({
  accessToken,
  bindings,
}: {
  accessToken: string;
  bindings: Bindings;
}) => Promise<User | null>;

async function getSupabaseUserFromToken({
  accessToken,
  bindings,
}: {
  accessToken: string;
  bindings: Bindings;
}) {
  const supabaseConfig = getSupabaseAuthConfig(bindings);
  const supabase = createSupabaseUserClient({
    ...supabaseConfig,
    accessToken,
  });

  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export function createRequireAuth(
  getUser: GetUserFromToken = getSupabaseUserFromToken,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const accessToken = getBearerToken(c.req.header('Authorization'));

    if (!accessToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const user = await getUser({
      accessToken,
      bindings: c.env,
    });

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    c.set('authUser', user);
    c.set('authAccessToken', accessToken);

    await next();
  });
}

export const requireAuth = createRequireAuth();
