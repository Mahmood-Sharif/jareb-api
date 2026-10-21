#!/usr/bin/env node

import {
  createLocalClient,
  loadLocalConfig,
  printableClassifications,
  saveState,
  setupFixtures,
} from './lib/local-profile-phone-reconciliation.mjs';

const config = await loadLocalConfig();
const state = await setupFixtures(createLocalClient(config));
await saveState(state);

console.log('Local profile-phone fixtures created', {
  supabaseUrl: config.url,
  safeAttachCanonicalId: state.cases.safeAttach.canonical.id,
  safeDuplicateCanonicalId: state.cases.safeDuplicate.canonical.id,
  safeDuplicateAuthId: state.cases.safeDuplicate.duplicate.id,
  classifications: printableClassifications(state.classifications),
});
