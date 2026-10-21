#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BAHRAIN_PHONE_RE = /^\+973\d{8}$/;
const USERS_PAGE_SIZE = 1000;

const supabaseUrl = requiredEnv('SUPABASE_URL');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const canonicalUserId = requiredEnv('CANONICAL_USER_ID');
const duplicateUserId = requiredEnv('DUPLICATE_USER_ID');
const dryRun = envBool('DRY_RUN', false);

if (!UUID_RE.test(canonicalUserId)) {
  fail('CANONICAL_USER_ID must be a valid UUID.');
}
if (!UUID_RE.test(duplicateUserId)) {
  fail('DUPLICATE_USER_ID must be a valid UUID.');
}
if (canonicalUserId === duplicateUserId) {
  fail('CANONICAL_USER_ID and DUPLICATE_USER_ID must be different UUIDs.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const canonicalUser = await loadAuthUser(canonicalUserId);
const profilePhone = await loadProfilePhone(canonicalUserId);
const phone = normalizeCanonicalBahrainPhone(profilePhone);
const currentAuthPhone = normalizeNullableBahrainPhone(canonicalUser.phone);
const duplicateUser = await loadOptionalAuthUser(duplicateUserId);
const canonicalDataBefore = await loadJarebDataCounts(canonicalUserId);

assertCanonicalEmailUser(canonicalUser);

if (duplicateUser) {
  assertDisposablePhoneUser({ duplicateUser, phone });
  const duplicateData = await loadJarebDataCounts(duplicateUserId);
  assertNoJarebData(duplicateData);
}

if (
  currentAuthPhone === phone &&
  isPhoneConfirmed(canonicalUser) &&
  authProviders(canonicalUser).has('phone')
) {
  if (duplicateUser) {
    fail(
      'Canonical Auth phone is already confirmed, but DUPLICATE_USER_ID still exists. Refusing an ambiguous deletion.',
    );
  }
  console.log('Reconciliation already complete.', {
    canonicalUserId,
    authPhone: maskPhone(currentAuthPhone),
    profilePhone: maskPhone(phone),
    phoneConfirmedAt: canonicalUser.phone_confirmed_at ?? null,
  });
  process.exit(0);
}

const otherOwner = await findOtherAuthUserByPhone({
  phone,
  canonicalUserId,
});

if (otherOwner) {
  if (!duplicateUser || otherOwner.id !== duplicateUserId) {
    fail(
      [
        'An unexpected Supabase Auth user owns this profile phone.',
        `Other auth user id: ${otherOwner.id}`,
        'No Auth users were changed.',
      ].join('\n'),
    );
  }
}

console.log('Preflight passed.', {
  canonicalUserId,
  duplicateUserId,
  duplicateUserPresent: duplicateUser !== null,
  currentAuthPhone: maskPhone(currentAuthPhone),
  profilePhone: maskPhone(phone),
  dryRun,
});

if (dryRun) {
  console.log('DRY_RUN=true; no Auth users were changed.');
  process.exit(0);
}

if (duplicateUser) {
  const { error: deleteError } = await supabase.auth.admin.deleteUser(
    duplicateUserId,
    false,
  );

  if (deleteError) {
    fail(`Failed to delete duplicate Auth user: ${deleteError.message}`);
  }

  const deletedUser = await loadOptionalAuthUser(duplicateUserId);
  if (deletedUser) {
    fail('Duplicate Auth user still exists after deleteUser returned success.');
  }

  console.log('Duplicate phone-only Auth user removed.', {
    duplicateUserId,
  });
}

const { data: updateData, error: updateError } =
  await supabase.auth.admin.updateUserById(canonicalUserId, {
    phone,
    phone_confirm: true,
  });

if (updateError) {
  fail(`Failed to update canonical Auth user: ${updateError.message}`);
}

const updatedUser = updateData?.user ?? (await loadAuthUser(canonicalUserId));
if (updatedUser.id !== canonicalUserId) {
  fail('Supabase returned a different user id after update.');
}

const rereadUser = await loadAuthUser(canonicalUserId);
const rereadPhone = normalizeNullableBahrainPhone(rereadUser.phone);
if (rereadPhone !== phone) {
  fail(
    `Auth user phone verification failed after update. Expected ${maskPhone(
      phone,
    )}, got ${maskPhone(rereadPhone)}.`,
  );
}
if (!isPhoneConfirmed(rereadUser)) {
  fail('Auth user phone is attached but is not confirmed.');
}
if (!authProviders(rereadUser).has('phone')) {
  fail('Auth user phone was updated, but the phone provider is not attached.');
}
if (rereadUser.email !== canonicalUser.email) {
  fail('Canonical Auth email changed unexpectedly.');
}

const canonicalDataAfter = await loadJarebDataCounts(canonicalUserId);
if (JSON.stringify(canonicalDataAfter) !== JSON.stringify(canonicalDataBefore)) {
  fail('Canonical Jareb row counts changed unexpectedly during reconciliation.');
}

console.log('Canonical Auth user phone attached.', {
  canonicalUserId: rereadUser.id,
  phone: maskPhone(rereadPhone),
  phoneConfirmedAt: rereadUser.phone_confirmed_at ?? null,
});

async function loadAuthUser(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    fail(`Canonical Auth user was not found or could not be read: ${error.message}`);
  }

  if (!data?.user?.id) {
    fail('Canonical Auth user was not found.');
  }

  return data.user;
}

async function loadOptionalAuthUser(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.code === 'user_not_found') return null;
    fail(`Auth user could not be read: ${error.message}`);
  }

  return data?.user?.id ? data.user : null;
}

async function loadProfilePhone(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    fail(`Could not load public.profiles row: ${error.message}`);
  }

  if (!data) {
    fail('public.profiles row does not exist for the canonical user.');
  }

  if (typeof data.phone !== 'string' || data.phone.trim() === '') {
    fail('public.profiles.phone is missing for the canonical user.');
  }

  return data.phone;
}

async function loadJarebDataCounts(userId) {
  const definitions = [
    ['profiles', 'id'],
    ['admin_users', 'user_id'],
    ['claims', 'user_id'],
    ['claim_receipts', 'user_id'],
    ['saved_drops', 'user_id'],
    ['user_merchant_redemptions', 'user_id'],
  ];
  const counts = {};

  for (const [table, column] of definitions) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, userId);

    if (error) {
      fail(`Could not check ${table} ownership: ${error.message}`);
    }
    counts[table] = count ?? 0;
  }

  return counts;
}

function assertCanonicalEmailUser(user) {
  if (typeof user.email !== 'string' || user.email.trim() === '') {
    fail('Canonical Auth user has no email.');
  }
  if (!authProviders(user).has('email')) {
    fail('Canonical Auth user does not have the email provider.');
  }
}

function assertDisposablePhoneUser({ duplicateUser, phone }) {
  const duplicatePhone = normalizeNullableBahrainPhone(duplicateUser.phone);
  if (duplicatePhone !== phone) {
    fail('Duplicate Auth user does not own the canonical profile phone.');
  }
  if (
    typeof duplicateUser.email === 'string' &&
    duplicateUser.email.trim() !== ''
  ) {
    fail('Duplicate Auth user has an email and is not safely disposable.');
  }

  const providers = authProviders(duplicateUser);
  if (providers.size !== 1 || !providers.has('phone')) {
    fail('Duplicate Auth user is not phone-only and is not safely disposable.');
  }
}

function assertNoJarebData(counts) {
  const ownedTables = Object.entries(counts).filter(([, count]) => count !== 0);
  if (ownedTables.length === 0) return;

  fail(
    `Duplicate Auth user owns Jareb data (${ownedTables
      .map(([table, count]) => `${table}=${count}`)
      .join(', ')}); refusing deletion.`,
  );
}

function authProviders(user) {
  const providers = new Set();
  const metadataProviders = user.app_metadata?.providers;
  if (Array.isArray(metadataProviders)) {
    for (const provider of metadataProviders) {
      if (typeof provider === 'string' && provider.trim() !== '') {
        providers.add(provider.trim());
      }
    }
  }
  if (typeof user.app_metadata?.provider === 'string') {
    providers.add(user.app_metadata.provider.trim());
  }
  for (const identity of user.identities ?? []) {
    if (typeof identity.provider === 'string' && identity.provider.trim() !== '') {
      providers.add(identity.provider.trim());
    }
  }
  return providers;
}

async function findOtherAuthUserByPhone({ phone, canonicalUserId }) {
  let page = 1;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: USERS_PAGE_SIZE,
    });

    if (error) {
      fail(`Could not list Auth users for phone uniqueness preflight: ${error.message}`);
    }

    const users = data?.users ?? [];
    const match = users.find((user) => {
      if (user.id === canonicalUserId) return false;
      return tryNormalizeBahrainPhone(user.phone) === phone;
    });
    if (match) return match;

    if (users.length < USERS_PAGE_SIZE) return null;
    page += 1;
  }
}

function normalizeCanonicalBahrainPhone(value) {
  const compact = value.trim().replace(/[^\d+]/g, '');
  const canonical = compact.startsWith('+')
    ? compact
    : compact.startsWith('973')
      ? `+${compact}`
      : `+973${compact}`;

  if (!BAHRAIN_PHONE_RE.test(canonical)) {
    fail('public.profiles.phone is not a canonical Bahrain phone (+973XXXXXXXX).');
  }

  return canonical;
}

function normalizeNullableBahrainPhone(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return normalizeCanonicalBahrainPhone(value);
}

function tryNormalizeBahrainPhone(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const compact = value.trim().replace(/[^\d+]/g, '');
  const canonical = compact.startsWith('+')
    ? compact
    : compact.startsWith('973')
      ? `+${compact}`
      : `+973${compact}`;
  return BAHRAIN_PHONE_RE.test(canonical) ? canonical : null;
}

function isPhoneConfirmed(user) {
  return (
    typeof user.phone_confirmed_at === 'string' &&
    user.phone_confirmed_at.trim() !== ''
  );
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`${name} is required.`);
  }
  return value;
}

function envBool(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(value);
}

function maskPhone(value) {
  if (!value) return null;
  return value.replace(/^(\+973)(\d{4})(\d{4})$/, '$1****$3');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
