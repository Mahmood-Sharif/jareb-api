#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

import {
  ReconciliationState,
  authProviders,
  classifyProfilePhone,
  maskPhone,
  normalizeBahrainPhone,
} from './lib/profile-phone-reconciliation.mjs';

const PAGE_SIZE = 1000;
const supabaseUrl = requiredEnv('SUPABASE_URL');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const dryRun = requiredBooleanEnv('DRY_RUN');
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const profiles = await loadProfiles();
const authUsers = await loadAuthUsers();
const results = [];
for (const profile of profiles) {
  results.push(
    await classifyProfilePhone({
      profile,
      allProfiles: profiles,
      authUsers,
      loadOwnedData: loadJarebDataCounts,
    }),
  );
}

printAudit(results, profiles.length);
if (dryRun) {
  console.log('DRY_RUN=true; zero writes were made.');
  process.exit(0);
}

let repaired = 0;
let skipped = 0;
let failed = 0;
for (const proposal of results.filter((result) => isSafe(result.state))) {
  try {
    const fresh = await reclassify(proposal.canonicalUserId);
    if (!sameProposal(proposal, fresh)) {
      skipped += 1;
      console.warn('SKIPPED state changed before write', printable(fresh));
      continue;
    }
    await executeRepair(fresh);
    repaired += 1;
  } catch (error) {
    failed += 1;
    console.error('FAILED repair', {
      canonicalUserId: proposal.canonicalUserId,
      duplicateUserId: proposal.duplicateUserId,
      phone: maskPhone(proposal.phone),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

console.log('Execution summary', { repaired, skipped, failed });
if (failed > 0) process.exitCode = 1;

async function executeRepair(proposal) {
  const canonicalBefore = await loadRequiredAuthUser(proposal.canonicalUserId);
  const canonicalEmail = canonicalBefore.email;
  const canonicalCounts = await loadJarebDataCounts(proposal.canonicalUserId);
  const profileBefore = await loadRequiredProfile(proposal.canonicalUserId);
  if (normalizeBahrainPhone(profileBefore.phone) !== proposal.phone) {
    throw new Error('Canonical profile phone changed before write.');
  }

  if (proposal.state === ReconciliationState.safeReconcileDuplicate) {
    const duplicateBefore = await loadRequiredAuthUser(proposal.duplicateUserId);
    const freshDuplicateCounts = await loadJarebDataCounts(duplicateBefore.id);
    if (Object.values(freshDuplicateCounts).some((count) => count !== 0)) {
      throw new Error('Duplicate acquired Jareb data before deletion.');
    }

    const { error } = await supabase.auth.admin.deleteUser(duplicateBefore.id, false);
    if (error) throw new Error(`Duplicate Auth deletion failed: ${error.message}`);
    if (await loadOptionalAuthUser(duplicateBefore.id)) {
      throw new Error('Duplicate Auth user still exists after deletion.');
    }
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    proposal.canonicalUserId,
    { phone: proposal.phone, phone_confirm: true },
  );
  if (updateError) throw new Error(`Canonical Auth update failed: ${updateError.message}`);

  const canonicalAfter = await loadRequiredAuthUser(proposal.canonicalUserId);
  const profileAfter = await loadRequiredProfile(proposal.canonicalUserId);
  const countsAfter = await loadJarebDataCounts(proposal.canonicalUserId);
  if (canonicalAfter.id !== proposal.canonicalUserId) {
    throw new Error('Canonical UUID changed unexpectedly.');
  }
  if (canonicalAfter.email !== canonicalEmail) {
    throw new Error('Canonical email changed unexpectedly.');
  }
  if (normalizeBahrainPhone(canonicalAfter.phone) !== proposal.phone) {
    throw new Error('Canonical Auth phone does not match the profile phone.');
  }
  if (!canonicalAfter.phone_confirmed_at) {
    throw new Error('Canonical Auth phone is not confirmed.');
  }
  if (!authProviders(canonicalAfter).has('phone')) {
    throw new Error('Canonical phone provider is not attached.');
  }
  if (normalizeBahrainPhone(profileAfter.phone) !== proposal.phone) {
    throw new Error('Canonical profile changed unexpectedly.');
  }
  if (JSON.stringify(countsAfter) !== JSON.stringify(canonicalCounts)) {
    throw new Error('Canonical Jareb row counts changed unexpectedly.');
  }
  if (proposal.duplicateUserId && (await loadOptionalAuthUser(proposal.duplicateUserId))) {
    throw new Error('Duplicate Auth UUID still exists after reconciliation.');
  }

  const finalState = await reclassify(proposal.canonicalUserId);
  if (finalState.state !== ReconciliationState.alreadyCorrect) {
    throw new Error(`Post-repair state is ${finalState.state}.`);
  }
  console.log('REPAIRED', printable(finalState));
}

async function reclassify(canonicalUserId) {
  const freshProfiles = await loadProfiles();
  const profile = freshProfiles.find((candidate) => candidate.id === canonicalUserId);
  if (!profile) throw new Error('Canonical profile disappeared before write.');
  return classifyProfilePhone({
    profile,
    allProfiles: freshProfiles,
    authUsers: await loadAuthUsers(),
    loadOwnedData: loadJarebDataCounts,
  });
}

async function loadProfiles() {
  const rows = [];
  for (let page = 0; ; page += 1) {
    const start = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, phone')
      .not('phone', 'is', null)
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load profiles: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

async function loadAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Could not load Auth users: ${error.message}`);
    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < PAGE_SIZE) break;
  }

  // listUsers can omit identities, while identity ownership is a required
  // safety input for this reconciliation. Hydrate every user before classifying.
  const hydratedUsers = [];
  for (const user of users) {
    const hydratedUser = await loadOptionalAuthUser(user.id);
    if (hydratedUser) hydratedUsers.push(hydratedUser);
  }
  return hydratedUsers;
}

async function loadRequiredAuthUser(userId) {
  const user = await loadOptionalAuthUser(userId);
  if (!user) throw new Error(`Required Auth user ${userId} is missing.`);
  return user;
}

async function loadOptionalAuthUser(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.code === 'user_not_found') return null;
    throw new Error(`Could not load Auth user ${userId}: ${error.message}`);
  }
  return data?.user?.id ? data.user : null;
}

async function loadRequiredProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, phone')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load canonical profile: ${error.message}`);
  if (!data) throw new Error('Canonical profile is missing.');
  return data;
}

async function loadJarebDataCounts(userId) {
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
  const { data: receiptObjects, error: receiptStorageError } = await supabase.storage
    .from('claim-receipts')
    .list(userId, { limit: 1 });
  if (receiptStorageError) {
    throw new Error(
      `Could not inspect claim receipt storage: ${receiptStorageError.message}`,
    );
  }
  counts.claim_receipt_storage_objects = receiptObjects?.length ?? 0;
  return counts;
}

function printAudit(results, total) {
  const counts = Object.fromEntries(
    Object.values(ReconciliationState).map((state) => [
      state,
      results.filter((result) => result.state === state).length,
    ]),
  );
  console.log('Profile phone reconciliation audit', {
    totalProfilesScanned: total,
    alreadyCorrect: counts.ALREADY_CORRECT,
    safeAttach: counts.SAFE_ATTACH,
    safeDuplicateReconciliation: counts.SAFE_RECONCILE_DUPLICATE,
    reviewRequired: counts.REVIEW_REQUIRED,
  });
  for (const result of results.filter((item) => item.state !== ReconciliationState.alreadyCorrect)) {
    console.log(result.state, printable(result));
  }
}

function printable(result) {
  return {
    canonicalUserId: result.canonicalUserId,
    duplicateUserId: result.duplicateUserId,
    phone: maskPhone(result.phone),
    reason: result.reason,
  };
}

function isSafe(state) {
  return (
    state === ReconciliationState.safeAttach ||
    state === ReconciliationState.safeReconcileDuplicate
  );
}

function sameProposal(before, after) {
  return (
    before.state === after.state &&
    before.phone === after.phone &&
    before.canonicalUserId === after.canonicalUserId &&
    before.duplicateUserId === after.duplicateUserId
  );
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredBooleanEnv(name) {
  const value = requiredEnv(name).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(value)) return true;
  if (['false', '0', 'no', 'n'].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}
