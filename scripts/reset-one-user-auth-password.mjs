#!/usr/bin/env node

// Local-only production recovery utility. Do not deploy this script.
import { createClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const supabaseUrl = requiredTrimmedEnv('SUPABASE_URL');
const serviceRoleKey = requiredTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY');
const userId = requiredTrimmedEnv('USER_ID');
const newPassword = requiredSecretEnv('NEW_PASSWORD');

if (!UUID_RE.test(userId)) {
  fail('USER_ID must be a valid UUID.');
}

try {
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== 'https:') {
    fail('SUPABASE_URL must use HTTPS.');
  }
} catch {
  fail('SUPABASE_URL must be a valid URL.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

await main().catch(() => {
  fail('Password reset failed: unexpected Admin API error.');
});

async function main() {
  const originalUser = await loadUser(userId);
  const originalIdentityKeys = identityKeys(originalUser);

  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (error) {
    fail(`Password reset failed: ${error.message}`);
  }

  if (!data?.user || data.user.id !== userId) {
    fail('Password reset failed: Supabase returned an unexpected user.');
  }

  const verifiedUser = await loadUser(userId);
  if (
    verifiedUser.id !== originalUser.id ||
    verifiedUser.email !== originalUser.email ||
    verifiedUser.phone !== originalUser.phone ||
    identityKeys(verifiedUser) !== originalIdentityKeys
  ) {
    fail(
      'Password reset failed: protected Auth user fields changed unexpectedly.',
    );
  }

  console.log('Password reset succeeded.', {
    userId: verifiedUser.id,
    email: verifiedUser.email ?? null,
  });
}

async function loadUser(id) {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error) {
    fail(`Password reset failed: ${error.message}`);
  }
  if (!data?.user || data.user.id !== id) {
    fail('Password reset failed: Auth user does not exist.');
  }
  return data.user;
}

function identityKeys(user) {
  return (user.identities ?? [])
    .map((identity) => `${identity.id}:${identity.provider}`)
    .sort()
    .join('|');
}

function requiredTrimmedEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function requiredSecretEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required.`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
