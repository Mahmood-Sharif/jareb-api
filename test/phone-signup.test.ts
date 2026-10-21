import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/index';

describe('POST /auth/phone-signup-eligibility', () => {
  it('reports an existing canonical profile without exposing account data', async () => {
    const phoneAccountExists = vi.fn(async () => true);
    const response = await createApp({ phoneAccountExists }).request(
      '/auth/phone-signup-eligibility',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+97333299655' }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accountExists: true });
    expect(phoneAccountExists).toHaveBeenCalledWith({
      bindings: {},
      phone: '+97333299655',
    });
  });

  it('allows a genuinely new normalized phone to continue signup', async () => {
    const response = await createApp({
      phoneAccountExists: vi.fn(async () => false),
    }).request('/auth/phone-signup-eligibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '33299655' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accountExists: false });
  });

  it('rejects malformed payloads without querying account data', async () => {
    const phoneAccountExists = vi.fn(async () => false);
    const response = await createApp({ phoneAccountExists }).request(
      '/auth/phone-signup-eligibility',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );

    expect(response.status).toBe(400);
    expect(phoneAccountExists).not.toHaveBeenCalled();
  });
});
