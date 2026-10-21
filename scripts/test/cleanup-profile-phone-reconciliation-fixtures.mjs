#!/usr/bin/env node

import {
  cleanupFixtures,
  createLocalClient,
  loadLocalConfig,
} from './lib/local-profile-phone-reconciliation.mjs';

const config = await loadLocalConfig();
const result = await cleanupFixtures(createLocalClient(config));
console.log('Local profile-phone fixtures cleaned', {
  supabaseUrl: config.url,
  deletedUsers: result.deletedUsers,
});
