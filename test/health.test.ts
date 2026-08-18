import { describe, expect, it } from 'vitest';

import { createApp } from '../src/index';

describe('GET /health', () => {
  it('returns the service health payload', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'jareb-api',
    });
  });
});
