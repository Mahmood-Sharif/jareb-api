import assert from 'node:assert/strict';
import test from 'node:test';

import { assertLocalSupabaseUrl } from './lib/local-profile-phone-reconciliation.mjs';

test('accepts only loopback Supabase fixture URLs', () => {
  assert.equal(assertLocalSupabaseUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  assert.equal(assertLocalSupabaseUrl('http://localhost:54321/'), 'http://localhost:54321');
});

test('rejects production or malformed Supabase URLs with the required message', () => {
  for (const value of ['https://example.supabase.co', 'not-a-url', 'http://192.168.1.2:54321']) {
    assert.throws(
      () => assertLocalSupabaseUrl(value),
      new Error('Refusing to run auth reconciliation fixture against non-local Supabase.'),
    );
  }
});
