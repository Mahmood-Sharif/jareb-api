import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import {
  ReconciliationState,
  authProviders,
  classifyProfilePhone,
  maskPhone,
  normalizeBahrainPhone,
} from '../../lib/profile-phone-reconciliation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const API_ROOT = resolve(HERE, '..', '..', '..');
export const STATE_PATH = resolve(
  API_ROOT,
  '..',
  '.test-tmp',
  'profile-phone-reconciliation-fixtures.json',
);
const RECONCILER_PATH = resolve(API_ROOT, 'scripts', 'reconcile-all-profile-phones.mjs');
const LOCAL_PASSWORD = 'JarebLocalReconcile123!';
const FIXTURE_MARKER = 'profile_phone_reconciliation_v1';
const DROP_ID = '40000000-0000-0000-0000-000000000001';
const SAVED_DROP_ID = '40000000-0000-0000-0000-000000000002';
const MERCHANT_ID = '30000000-0000-0000-0000-000000000001';

const DEFINITIONS = Object.freeze({
  safeAttach: {
    key: 'safe_attach',
    phone: '+97336992001',
    benefitpay: '+97339992001',
  },
  safeDuplicate: {
    key: 'safe_duplicate',
    phone: '+97336992002',
    benefitpay: '+97339992002',
  },
  duplicateClaim: {
    key: 'danger_duplicate_claim',
    phone: '+97336992003',
    benefitpay: '+97339992003',
  },
  duplicateProfile: {
    key: 'danger_duplicate_profile',
    phone: '+97336992004',
    benefitpay: '+97339992004',
    duplicateProfilePhone: '+97336992904',
    duplicateBenefitpay: '+97339992904',
  },
  duplicateEmail: {
    key: 'danger_duplicate_email',
    phone: '+97336992005',
    benefitpay: '+97339992005',
  },
  canonicalDifferentPhone: {
    key: 'danger_canonical_different_phone',
    phone: '+97336992006',
    benefitpay: '+97339992006',
    authPhone: '+97336992906',
  },
  duplicateProfilesA: {
    key: 'danger_duplicate_profiles_a',
    phone: '+97336992007',
    benefitpay: '+97339992007',
  },
  duplicateProfilesB: {
    key: 'danger_duplicate_profiles_b',
    phone: '36992007',
    benefitpay: '+97339992907',
  },
  thirdOwner: {
    key: 'danger_third_owner',
    phone: '+97336992008',
    benefitpay: '+97339992008',
  },
  raceMissingProfile: {
    key: 'race_missing_profile',
    phone: '+97336992009',
    benefitpay: '+97339992009',
  },
  raceDuplicateData: {
    key: 'race_duplicate_data',
    phone: '+97336992010',
    benefitpay: '+97339992010',
  },
});

export function assertLocalSupabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Refusing to run auth reconciliation fixture against non-local Supabase.');
  }
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('Refusing to run auth reconciliation fixture against non-local Supabase.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function loadLocalConfig() {
  const fileValues = await readEnvFile(resolve(API_ROOT, '.dev.vars'));
  const runningStackValues = await readEnvFile(
    resolve(
      API_ROOT,
      '..',
      'jareb-infra',
      'supabase',
      '.temp',
      'start-secrets',
      'supabase_edge_runtime_Jareb',
      'env',
      'docker.env',
    ),
  );
  const url = assertLocalSupabaseUrl(
    process.env.SUPABASE_URL?.trim() || fileValues.SUPABASE_URL,
  );
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    runningStackValues.SUPABASE_SERVICE_ROLE_KEY ||
    fileValues.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
  return { url, serviceRoleKey };
}

export function createLocalClient(config) {
  assertLocalSupabaseUrl(config.url);
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function setupFixtures(supabase) {
  await cleanupFixtures(supabase);
  await alignExistingLocalProfiles(supabase);
  const unrelatedBefore = await snapshotUnrelatedAuthUsers(supabase);

  const safeAttach = await createCanonicalFixture(supabase, DEFINITIONS.safeAttach);
  await addRepresentativeData(supabase, safeAttach, 'SAFE-A');

  const safeDuplicate = await createCanonicalFixture(
    supabase,
    DEFINITIONS.safeDuplicate,
  );
  safeDuplicate.duplicate = await createPhoneUser(
    supabase,
    `${DEFINITIONS.safeDuplicate.key}_duplicate`,
    DEFINITIONS.safeDuplicate.phone,
  );
  await addRepresentativeData(supabase, safeDuplicate, 'SAFE-B');

  const duplicateClaim = await createCanonicalFixture(
    supabase,
    DEFINITIONS.duplicateClaim,
  );
  duplicateClaim.duplicate = await createPhoneUser(
    supabase,
    `${DEFINITIONS.duplicateClaim.key}_duplicate`,
    DEFINITIONS.duplicateClaim.phone,
  );
  await addClaim(supabase, duplicateClaim.duplicate.id, 'DANGER-CLAIM');

  const duplicateProfile = await createCanonicalFixture(
    supabase,
    DEFINITIONS.duplicateProfile,
  );
  duplicateProfile.duplicate = await createPhoneUser(
    supabase,
    `${DEFINITIONS.duplicateProfile.key}_duplicate`,
    DEFINITIONS.duplicateProfile.phone,
  );
  await insertProfile(supabase, {
    id: duplicateProfile.duplicate.id,
    fullName: 'Duplicate With Profile',
    phone: DEFINITIONS.duplicateProfile.duplicateProfilePhone,
    benefitpay: DEFINITIONS.duplicateProfile.duplicateBenefitpay,
  });

  const duplicateEmail = await createCanonicalFixture(
    supabase,
    DEFINITIONS.duplicateEmail,
  );
  duplicateEmail.duplicate = await createPhoneUser(
    supabase,
    `${DEFINITIONS.duplicateEmail.key}_duplicate`,
    DEFINITIONS.duplicateEmail.phone,
    { email: fixtureEmail(`${DEFINITIONS.duplicateEmail.key}_duplicate`) },
  );

  const canonicalDifferentPhone = await createCanonicalFixture(
    supabase,
    DEFINITIONS.canonicalDifferentPhone,
    { authPhone: DEFINITIONS.canonicalDifferentPhone.authPhone },
  );

  const duplicateProfilesA = await createCanonicalFixture(
    supabase,
    DEFINITIONS.duplicateProfilesA,
  );
  const duplicateProfilesB = await createCanonicalFixture(
    supabase,
    DEFINITIONS.duplicateProfilesB,
  );

  const thirdOwner = await tryCreateThirdOwnerFixture(supabase);

  const raceMissingProfile = await createCanonicalFixture(
    supabase,
    DEFINITIONS.raceMissingProfile,
  );

  const raceDuplicateData = await createCanonicalFixture(
    supabase,
    DEFINITIONS.raceDuplicateData,
  );
  raceDuplicateData.duplicate = await createPhoneUser(
    supabase,
    `${DEFINITIONS.raceDuplicateData.key}_duplicate`,
    DEFINITIONS.raceDuplicateData.phone,
  );

  const cases = {
    safeAttach,
    safeDuplicate,
    duplicateClaim,
    duplicateProfile,
    duplicateEmail,
    canonicalDifferentPhone,
    duplicateProfilesA,
    duplicateProfilesB,
    thirdOwner,
    raceMissingProfile,
    raceDuplicateData,
  };

  const classifications = await classifyCases(supabase, cases);
  assert.equal(classifications.safeAttach.state, ReconciliationState.safeAttach);
  assert.equal(
    classifications.safeDuplicate.state,
    ReconciliationState.safeReconcileDuplicate,
  );
  for (const key of [
    'duplicateClaim',
    'duplicateProfile',
    'duplicateEmail',
    'canonicalDifferentPhone',
    'duplicateProfilesA',
    'duplicateProfilesB',
  ]) {
    assert.equal(classifications[key].state, ReconciliationState.reviewRequired);
  }
  if (thirdOwner.established) {
    assert.equal(classifications.thirdOwner.state, ReconciliationState.reviewRequired);
  }
  assert.equal(
    classifications.raceMissingProfile.state,
    ReconciliationState.safeAttach,
  );
  assert.equal(
    classifications.raceDuplicateData.state,
    ReconciliationState.safeReconcileDuplicate,
  );

  const before = {
    safeAttach: await snapshotCanonical(supabase, safeAttach),
    safeDuplicate: await snapshotCanonical(supabase, safeDuplicate),
  };
  return {
    createdAt: new Date().toISOString(),
    cases,
    classifications,
    before,
    unrelatedBefore,
  };
}

export async function mutateRaceFixtures(supabase, state) {
  const missingId = state.cases.raceMissingProfile.canonical.id;
  const { error: profileError } = await supabase
    .from('profiles')
    .delete()
    .eq('id', missingId);
  if (profileError) throw new Error(`Could not remove race profile: ${profileError.message}`);

  await addClaim(
    supabase,
    state.cases.raceDuplicateData.duplicate.id,
    'RACE-DATA',
  );
}

export async function verifyAfterReconciliation(supabase, state) {
  const after = {
    safeAttach: await snapshotCanonical(supabase, state.cases.safeAttach),
    safeDuplicate: await snapshotCanonical(supabase, state.cases.safeDuplicate),
  };
  for (const key of ['safeAttach', 'safeDuplicate']) {
    const beforeSnapshot = state.before[key];
    const afterSnapshot = after[key];
    assert.equal(afterSnapshot.auth.id, beforeSnapshot.auth.id);
    assert.equal(afterSnapshot.auth.email, beforeSnapshot.auth.email);
    assert.equal(
      normalizeBahrainPhone(afterSnapshot.auth.phone),
      normalizeBahrainPhone(beforeSnapshot.profile.phone),
    );
    assert.ok(afterSnapshot.auth.phoneConfirmedAt);
    assert.ok(afterSnapshot.auth.providers.includes('email'));
    assert.ok(afterSnapshot.auth.providers.includes('phone'));
    assert.deepEqual(afterSnapshot.profile, beforeSnapshot.profile);
    assert.deepEqual(afterSnapshot.counts, beforeSnapshot.counts);
  }
  assert.equal(
    await getOptionalAuthUser(supabase, state.cases.safeDuplicate.duplicate.id),
    null,
  );

  for (const key of [
    'duplicateClaim',
    'duplicateProfile',
    'duplicateEmail',
    'canonicalDifferentPhone',
    'duplicateProfilesA',
    'duplicateProfilesB',
  ]) {
    assert.ok(await getOptionalAuthUser(supabase, state.cases[key].canonical.id));
  }
  assert.ok(
    await getOptionalAuthUser(supabase, state.cases.duplicateClaim.duplicate.id),
  );
  assert.ok(
    await getOptionalAuthUser(supabase, state.cases.duplicateProfile.duplicate.id),
  );
  assert.ok(
    await getOptionalAuthUser(supabase, state.cases.duplicateEmail.duplicate.id),
  );

  const missingProfileAuth = await getRequiredAuthUser(
    supabase,
    state.cases.raceMissingProfile.canonical.id,
  );
  assert.equal(Boolean(missingProfileAuth.phone), false);
  const { data: missingProfile, error: missingProfileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', missingProfileAuth.id)
    .maybeSingle();
  if (missingProfileError) throw missingProfileError;
  assert.equal(missingProfile, null);

  assert.ok(
    await getOptionalAuthUser(supabase, state.cases.raceDuplicateData.duplicate.id),
  );
  assert.equal(
    (await loadOwnedData(supabase, state.cases.raceDuplicateData.duplicate.id)).claims,
    1,
  );

  assert.deepEqual(await snapshotUnrelatedAuthUsers(supabase), state.unrelatedBefore);

  const classifications = await classifyCases(supabase, state.cases);
  assert.equal(classifications.safeAttach.state, ReconciliationState.alreadyCorrect);
  assert.equal(
    classifications.safeDuplicate.state,
    ReconciliationState.alreadyCorrect,
  );
  assert.equal(
    classifications.raceDuplicateData.state,
    ReconciliationState.reviewRequired,
  );
  return { after, classifications };
}

export async function runProductionReconciler(config, dryRun) {
  assertLocalSupabaseUrl(config.url);
  const child = spawn(process.execPath, [RECONCILER_PATH], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      SUPABASE_URL: config.url,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      DRY_RUN: String(dryRun),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  });
  if (exitCode !== 0) {
    throw new Error(
      `Production reconciler exited ${exitCode}. ${sanitizeOutput(stderr || stdout)}`,
    );
  }
  return { stdout: sanitizeOutput(stdout), stderr: sanitizeOutput(stderr) };
}

export async function cleanupFixtures(supabase) {
  const users = (await listAuthUsers(supabase)).filter(isFixtureUser);
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return { deletedUsers: 0 };

  for (const userId of ids) await removeReceiptStorage(supabase, userId);

  const { data: deletions, error: deletionReadError } = await supabase
    .from('account_deletions')
    .select('id')
    .in('original_user_id', ids);
  if (deletionReadError) throw deletionReadError;
  const deletionIds = (deletions ?? []).map((row) => row.id);
  if (deletionIds.length > 0) {
    await checkedDelete(supabase, 'retained_payout_obligations', 'deleted_account_id', deletionIds);
  }
  await checkedDelete(supabase, 'claim_receipts', 'user_id', ids);
  await checkedDelete(supabase, 'user_merchant_redemptions', 'user_id', ids);
  await checkedDelete(supabase, 'saved_drops', 'user_id', ids);
  await checkedDelete(supabase, 'claims', 'user_id', ids);
  await checkedDelete(supabase, 'admin_users', 'user_id', ids);
  await checkedDelete(supabase, 'profiles', 'id', ids);
  await checkedDelete(supabase, 'account_deletions', 'original_user_id', ids);

  for (const user of users) {
    const { error } = await supabase.auth.admin.deleteUser(user.id, false);
    if (error && error.status !== 404) {
      throw new Error(`Could not delete fixture Auth user ${user.id}: ${error.message}`);
    }
  }
  return { deletedUsers: users.length };
}

export async function saveState(state) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function loadState() {
  return JSON.parse(await readFile(STATE_PATH, 'utf8'));
}

export function printableClassifications(classifications) {
  return Object.fromEntries(
    Object.entries(classifications).map(([key, value]) => [
      key,
      {
        state: value?.state ?? null,
        canonicalUserId: value?.canonicalUserId ?? null,
        duplicateUserId: value?.duplicateUserId ?? null,
        phone: maskPhone(value?.phone),
        reason: value?.reason ?? null,
      },
    ]),
  );
}

async function alignExistingLocalProfiles(supabase) {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, phone')
    .not('phone', 'is', null);
  if (error) throw error;
  const users = await listAuthUsers(supabase);
  for (const profile of profiles ?? []) {
    const phone = normalizeBahrainPhone(profile.phone);
    const user = users.find((candidate) => candidate.id === profile.id);
    if (!user) throw new Error(`Local baseline profile ${profile.id} has no Auth user.`);
    if (
      user.phone &&
      normalizeBahrainPhone(user.phone) === phone &&
      user.phone_confirmed_at &&
      authProviders(user).has('phone')
    ) {
      continue;
    }
    if (user.phone) {
      throw new Error(`Local baseline Auth user ${user.id} owns a different phone.`);
    }
    const owner = users.find(
      (candidate) => candidate.id !== user.id && ownsPhone(candidate, phone),
    );
    if (owner) throw new Error(`Local baseline phone is owned by ${owner.id}.`);
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      phone,
      phone_confirm: true,
    });
    if (updateError) throw updateError;
  }
}

async function createCanonicalFixture(supabase, definition, options = {}) {
  const email = fixtureEmail(definition.key);
  const attributes = {
    email,
    password: LOCAL_PASSWORD,
    email_confirm: true,
    user_metadata: fixtureMetadata(definition.key),
  };
  if (options.authPhone) {
    attributes.phone = options.authPhone;
    attributes.phone_confirm = true;
  }
  const canonical = await createAuthUser(supabase, attributes);
  await insertProfile(supabase, {
    id: canonical.id,
    fullName: `Local Reconciliation ${definition.key}`,
    phone: definition.phone,
    benefitpay: definition.benefitpay,
  });
  return { definition, canonical: summarizeAuthUser(canonical), duplicate: null };
}

async function createPhoneUser(supabase, key, phone, options = {}) {
  let user = await createAuthUser(supabase, {
    phone,
    phone_confirm: true,
    user_metadata: fixtureMetadata(key),
  });
  if (options.email) {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      email: options.email,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not attach fixture email identity: ${error.message}`);
    user = data.user;
    if (!user.email || !authProviders(user).has('email')) {
      throw new Error('Local GoTrue did not attach the dangerous-case email identity.');
    }
  }
  return summarizeAuthUser(user);
}

async function createAuthUser(supabase, attributes) {
  const { data, error } = await supabase.auth.admin.createUser(attributes);
  if (error) throw new Error(`Could not create local fixture Auth user: ${error.message}`);
  if (!data?.user?.id) throw new Error('Local fixture Auth user has no UUID.');
  return data.user;
}

async function tryCreateThirdOwnerFixture(supabase) {
  const firstOwner = await createPhoneUser(
    supabase,
    `${DEFINITIONS.thirdOwner.key}_owner_one`,
    DEFINITIONS.thirdOwner.phone,
  );
  try {
    const secondOwner = await createPhoneUser(
      supabase,
      `${DEFINITIONS.thirdOwner.key}_owner_two`,
      DEFINITIONS.thirdOwner.phone.replace('+', ''),
    );
    const canonical = await createCanonicalFixture(supabase, DEFINITIONS.thirdOwner);
    return { established: true, canonical: canonical.canonical, owners: [firstOwner, secondOwner] };
  } catch (error) {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(firstOwner.id, false);
    if (deleteError) throw deleteError;
    return {
      established: false,
      reason: `Local GoTrue rejected a second normalized phone owner: ${safeError(error)}`,
    };
  }
}

async function insertProfile(supabase, { id, fullName, phone, benefitpay }) {
  const { error } = await supabase.from('profiles').insert({
    id,
    full_name: fullName,
    phone,
    benefitpay_number: benefitpay,
    terms_accepted_at: new Date().toISOString(),
    terms_version: 'local-reconciliation-test',
    privacy_version: 'local-reconciliation-test',
  });
  if (error) throw new Error(`Could not insert fixture profile: ${error.message}`);
}

async function addRepresentativeData(supabase, fixture, suffix) {
  const claim = await addClaim(supabase, fixture.canonical.id, suffix, 'paid');
  const { error: savedError } = await supabase.from('saved_drops').insert({
    user_id: fixture.canonical.id,
    drop_id: SAVED_DROP_ID,
  });
  if (savedError) throw new Error(`Could not insert saved Drop: ${savedError.message}`);
  const { error: redemptionError } = await supabase
    .from('user_merchant_redemptions')
    .insert({
      user_id: fixture.canonical.id,
      merchant_id: MERCHANT_ID,
      first_claim_id: claim.id,
      redeemed_at: new Date().toISOString(),
    });
  if (redemptionError) {
    throw new Error(`Could not insert merchant redemption: ${redemptionError.message}`);
  }
}

async function addClaim(supabase, userId, suffix, status = 'claimed') {
  const now = new Date();
  const row = {
    user_id: userId,
    drop_id: DROP_ID,
    status,
    claimed_at: now.toISOString(),
    payout_phone: '+97339992999',
    claim_expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
  };
  if (status === 'paid') {
    row.validated_at = now.toISOString();
    row.approved_at = now.toISOString();
    row.paid_at = now.toISOString();
    row.amount_spent = 5;
  }
  const { data, error } = await supabase
    .from('claims')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`Could not insert ${suffix} claim: ${error.message}`);
  return data;
}

async function classifyCases(supabase, cases) {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, phone')
    .not('phone', 'is', null);
  if (error) throw error;
  const users = await listAuthUsers(supabase);
  const output = {};
  for (const [key, fixture] of Object.entries(cases)) {
    if (!fixture?.canonical?.id) {
      output[key] = null;
      continue;
    }
    const profile = profiles.find((candidate) => candidate.id === fixture.canonical.id);
    if (!profile) {
      output[key] = {
        state: 'PROFILE_MISSING',
        canonicalUserId: fixture.canonical.id,
      };
      continue;
    }
    output[key] = await classifyProfilePhone({
      profile,
      allProfiles: profiles,
      authUsers: users,
      loadOwnedData: (userId) => loadOwnedData(supabase, userId),
    });
  }
  return output;
}

async function snapshotCanonical(supabase, fixture) {
  const user = await getRequiredAuthUser(supabase, fixture.canonical.id);
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', fixture.canonical.id)
    .single();
  if (error) throw error;
  return {
    auth: summarizeAuthUser(user),
    profile,
    counts: await loadOwnedData(supabase, fixture.canonical.id),
  };
}

async function snapshotUnrelatedAuthUsers(supabase) {
  return (await listAuthUsers(supabase))
    .filter((user) => !isFixtureUser(user))
    .map(summarizeAuthUser)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function loadOwnedData(supabase, userId) {
  const definitions = [
    ['profiles', 'id'],
    ['admin_users', 'user_id'],
    ['claims', 'user_id'],
    ['claim_receipts', 'user_id'],
    ['saved_drops', 'user_id'],
    ['user_merchant_redemptions', 'user_id'],
    ['account_deletions', 'original_user_id'],
  ];
  const counts = {};
  for (const [table, column] of definitions) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, userId);
    if (error) throw new Error(`Could not inspect ${table}: ${error.message}`);
    counts[table] = count ?? 0;
  }
  const { data, error } = await supabase.storage
    .from('claim-receipts')
    .list(userId, { limit: 100 });
  if (error) throw new Error(`Could not inspect receipt storage: ${error.message}`);
  counts.claim_receipt_storage_objects = data?.length ?? 0;
  return counts;
}

async function listAuthUsers(supabase) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const current = data?.users ?? [];
    users.push(...current);
    if (current.length < 1000) break;
  }
  const hydrated = [];
  for (const user of users) {
    const current = await getOptionalAuthUser(supabase, user.id);
    if (current) hydrated.push(current);
  }
  return hydrated;
}

async function getRequiredAuthUser(supabase, userId) {
  const user = await getOptionalAuthUser(supabase, userId);
  if (!user) throw new Error(`Required local Auth user ${userId} is missing.`);
  return user;
}

async function getOptionalAuthUser(supabase, userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.code === 'user_not_found') return null;
    throw error;
  }
  return data?.user ?? null;
}

async function checkedDelete(supabase, table, column, values) {
  if (values.length === 0) return;
  const { error } = await supabase.from(table).delete().in(column, values);
  if (error) throw new Error(`Could not clean ${table}: ${error.message}`);
}

async function removeReceiptStorage(supabase, userId) {
  const bucket = supabase.storage.from('claim-receipts');
  const { data, error } = await bucket.list(userId, { limit: 1000 });
  if (error) throw error;
  const paths = (data ?? []).map((entry) => `${userId}/${entry.name}`);
  if (paths.length === 0) return;
  const { error: removeError } = await bucket.remove(paths);
  if (removeError) throw removeError;
}

async function readEnvFile(path) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

function fixtureMetadata(key) {
  return { reconciliation_fixture: FIXTURE_MARKER, fixture_key: key };
}

function fixtureEmail(key) {
  return `reconcile+${key}@jareb.local`;
}

function isFixtureUser(user) {
  return user.user_metadata?.reconciliation_fixture === FIXTURE_MARKER;
}

function ownsPhone(user, phone) {
  try {
    if (user.phone && normalizeBahrainPhone(user.phone) === phone) return true;
  } catch {
    // Invalid phones are intentionally not treated as owners of a canonical number.
  }
  return (user.identities ?? []).some((identity) => {
    if (identity.provider !== 'phone') return false;
    try {
      return normalizeBahrainPhone(identity.identity_data?.phone) === phone;
    } catch {
      return false;
    }
  });
}

function summarizeAuthUser(user) {
  return {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
    phoneConfirmedAt: user.phone_confirmed_at ?? null,
    providers: [...authProviders(user)].sort(),
  };
}

function sanitizeOutput(value) {
  return value.replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted-key]');
}

function safeError(error) {
  return error instanceof Error ? error.message : 'Unknown error';
}
