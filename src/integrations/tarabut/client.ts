import {
  createMalformedTarabutResponseError,
  createTarabutUpstreamError,
} from './errors';
import {
  tarabutAccessTokenResponseSchema,
  tarabutApiErrorResponseSchema,
  type TarabutAccessTokenResponse,
} from './types';

export type TarabutFetch = typeof fetch;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function postTarabutToken({
  url,
  body,
  customerUserId,
  fetcher = fetch,
}: {
  url: string;
  body: Record<string, string>;
  customerUserId?: string;
  fetcher?: TarabutFetch;
}): Promise<TarabutAccessTokenResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (customerUserId) {
    headers['X-TG-CustomerUserId'] = customerUserId;
  }

  const response = await fetcher(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = await readJson(response);

  if (!response.ok) {
    const parsedError = tarabutApiErrorResponseSchema.safeParse(json);
    throw createTarabutUpstreamError(
      response.status,
      parsedError.success ? parsedError.data : undefined,
    );
  }

  const parsed = tarabutAccessTokenResponseSchema.safeParse(json);

  if (!parsed.success) {
    throw createMalformedTarabutResponseError();
  }

  return parsed.data;
}
