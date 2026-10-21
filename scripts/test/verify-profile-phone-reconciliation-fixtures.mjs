#!/usr/bin/env node

import {
  createLocalClient,
  loadLocalConfig,
  loadState,
  printableClassifications,
  verifyAfterReconciliation,
} from './lib/local-profile-phone-reconciliation.mjs';

const config = await loadLocalConfig();
const state = await loadState();
const verification = await verifyAfterReconciliation(createLocalClient(config), state);

console.log('Local profile-phone reconciliation verified', {
  supabaseUrl: config.url,
  classifications: printableClassifications(verification.classifications),
  after: verification.after,
});
