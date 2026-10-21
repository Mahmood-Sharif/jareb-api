#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  createLocalClient,
  loadLocalConfig,
  mutateRaceFixtures,
  printableClassifications,
  runProductionReconciler,
  saveState,
  setupFixtures,
  verifyAfterReconciliation,
} from './lib/local-profile-phone-reconciliation.mjs';

const config = await loadLocalConfig();
const supabase = createLocalClient(config);
const state = await setupFixtures(supabase);
await saveState(state);

const firstDryRun = await runProductionReconciler(config, true);
assert.match(firstDryRun.stdout, /SAFE_ATTACH/);
assert.match(firstDryRun.stdout, /SAFE_RECONCILE_DUPLICATE/);
assert.match(firstDryRun.stdout, new RegExp(state.cases.safeAttach.canonical.id));
assert.match(firstDryRun.stdout, new RegExp(state.cases.safeDuplicate.canonical.id));

await mutateRaceFixtures(supabase, state);
const firstExecution = await runProductionReconciler(config, false);
const firstVerification = await verifyAfterReconciliation(supabase, state);

const secondDryRun = await runProductionReconciler(config, true);
assert.doesNotMatch(
  blockForUser(secondDryRun.stdout, state.cases.safeAttach.canonical.id),
  /SAFE_ATTACH|SAFE_RECONCILE_DUPLICATE|REVIEW_REQUIRED/,
);
assert.doesNotMatch(
  blockForUser(secondDryRun.stdout, state.cases.safeDuplicate.canonical.id),
  /SAFE_ATTACH|SAFE_RECONCILE_DUPLICATE|REVIEW_REQUIRED/,
);

const beforeSecondExecution = JSON.stringify(firstVerification.after);
const secondExecution = await runProductionReconciler(config, false);
const secondVerification = await verifyAfterReconciliation(supabase, state);
assert.equal(JSON.stringify(secondVerification.after), beforeSecondExecution);

console.log('LOCAL PROFILE-PHONE RECONCILIATION INTEGRATION PASSED', {
  supabaseUrl: config.url,
  fixtureIds: {
    safeAttachCanonical: state.cases.safeAttach.canonical.id,
    safeDuplicateCanonical: state.cases.safeDuplicate.canonical.id,
    safeDuplicateRemoved: state.cases.safeDuplicate.duplicate.id,
  },
  beforeClassifications: printableClassifications(state.classifications),
  afterClassifications: printableClassifications(secondVerification.classifications),
  firstExecution: executionSummary(firstExecution.stdout),
  secondExecution: executionSummary(secondExecution.stdout),
  thirdOwnerCase: state.cases.thirdOwner,
  idempotent: true,
});

function executionSummary(output) {
  const match = output.match(/Execution summary\s+(\{[^\n]+\})/);
  return match?.[1] ?? 'Execution completed successfully.';
}

function blockForUser(output, userId) {
  const lines = output.split(/\r?\n/);
  return lines.filter((line) => line.includes(userId)).join('\n');
}
