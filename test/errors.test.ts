import { describe, expect, it } from 'vitest';

import { createApp } from '../src/index';

describe('error responses', () => {
  it('returns a consistent JSON error shape for missing routes', async () => {
    const response = await createApp().request('/missing');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
      },
    });
  });
});
