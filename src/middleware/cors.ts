import type { MiddlewareHandler } from 'hono';

import { getAllowedOrigins } from '../config/env';
import type { AppEnv, Bindings } from '../types/app';

export const CORS_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
export const CORS_ALLOW_HEADERS = 'Authorization,Content-Type';
export const CORS_MAX_AGE_SECONDS = '86400';

function isLocalDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function resolveCorsOrigin(origin: string | null, bindings: Partial<Bindings> = {}) {
  if (!origin) return '';
  if (getAllowedOrigins(bindings).includes(origin)) return origin;
  // Production only answers to ALLOWED_ORIGINS. Localhost is a development convenience.
  if (bindings.ENVIRONMENT !== 'production' && isLocalDevelopmentOrigin(origin)) return origin;
  return '';
}

function applyCorsHeaders(headers: Headers, origin: string) {
  headers.set('Vary', appendVaryOrigin(headers.get('Vary')));
  headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
  headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);

  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
}

function appendVaryOrigin(current: string | null) {
  if (!current) return 'Origin';

  const values = current.split(',').map((value) => value.trim().toLowerCase());
  return values.includes('origin') ? current : `${current}, Origin`;
}

export function withCors(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = resolveCorsOrigin(c.req.header('Origin') ?? null, c.env ?? {});

    if (c.req.method === 'OPTIONS') {
      const headers = new Headers();
      applyCorsHeaders(headers, origin);
      headers.set('Access-Control-Max-Age', CORS_MAX_AGE_SECONDS);
      return new Response(null, { status: 204, headers });
    }

    await next();

    const headers = new Headers(c.res.headers);
    applyCorsHeaders(headers, origin);
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  };
}
