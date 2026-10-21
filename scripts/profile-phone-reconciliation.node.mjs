import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReconciliationState,
  classifyProfilePhone,
} from './lib/profile-phone-reconciliation.mjs';

const profile = { id: 'canonical', phone: '+97333299655' };
const emailUser = {
  id: 'canonical',
  email: 'existing@jareb.app',
  phone: null,
  app_metadata: { providers: ['email'] },
  identities: [{ provider: 'email', identity_data: {} }],
};
const phoneUser = {
  id: 'duplicate',
  email: null,
  phone: '97333299655',
  phone_confirmed_at: '2026-10-08T10:00:00Z',
  app_metadata: { providers: ['phone'] },
  identities: [
    { provider: 'phone', identity_data: { phone: '+97333299655' } },
  ],
};
const emptyData = async () => ({
  profiles: 0,
  admin_users: 0,
  claims: 0,
  claim_receipts: 0,
  saved_drops: 0,
  user_merchant_redemptions: 0,
  account_deletions: 0,
  claim_receipt_storage_objects: 0,
});

test('historical email user without Auth phone is safe to attach', async () => {
  const result = await classify([emailUser]);
  assert.equal(result.state, ReconciliationState.safeAttach);
});

test('disposable duplicate phone user is safe to reconcile', async () => {
  const result = await classify([emailUser, phoneUser]);
  assert.equal(result.state, ReconciliationState.safeReconcileDuplicate);
  assert.equal(result.duplicateUserId, 'duplicate');
});

test('duplicate with history requires manual review', async () => {
  const result = await classify([emailUser, phoneUser], async () => ({
    ...(await emptyData()),
    claims: 1,
  }));
  assert.equal(result.state, ReconciliationState.reviewRequired);
});

test('multiple Auth owners of the normalized phone require manual review', async () => {
  const secondPhoneOwner = {
    ...phoneUser,
    id: 'third-owner',
    phone: '33299655',
    identities: [
      { provider: 'phone', identity_data: { phone: '33299655' } },
    ],
  };
  const result = await classify([emailUser, phoneUser, secondPhoneOwner]);
  assert.equal(result.state, ReconciliationState.reviewRequired);
  assert.equal(
    result.reason,
    'Multiple Auth users or identities own the normalized phone.',
  );
});

test('correct canonical email and phone user is already correct', async () => {
  const result = await classify([
    {
      ...emailUser,
      phone: '+97333299655',
      phone_confirmed_at: '2026-10-08T10:00:00Z',
      app_metadata: { providers: ['email', 'phone'] },
      identities: [
        ...emailUser.identities,
        { provider: 'phone', identity_data: { phone: '+97333299655' } },
      ],
    },
  ]);
  assert.equal(result.state, ReconciliationState.alreadyCorrect);
});

test('a repeated repaired state is a no-op', async () => {
  const repairedUser = {
    ...emailUser,
    phone: '+97333299655',
    phone_confirmed_at: '2026-10-08T10:00:00Z',
    app_metadata: { providers: ['email', 'phone'] },
    identities: [
      ...emailUser.identities,
      { provider: 'phone', identity_data: { phone: '+97333299655' } },
    ],
  };
  assert.equal(
    (await classify([repairedUser])).state,
    ReconciliationState.alreadyCorrect,
  );
  assert.equal(
    (await classify([repairedUser])).state,
    ReconciliationState.alreadyCorrect,
  );
});

function classify(authUsers, loadOwnedData = emptyData) {
  return classifyProfilePhone({
    profile,
    allProfiles: [profile],
    authUsers,
    loadOwnedData,
  });
}
