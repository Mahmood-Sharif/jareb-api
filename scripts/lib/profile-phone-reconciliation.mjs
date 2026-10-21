export const ReconciliationState = Object.freeze({
  safeAttach: 'SAFE_ATTACH',
  safeReconcileDuplicate: 'SAFE_RECONCILE_DUPLICATE',
  alreadyCorrect: 'ALREADY_CORRECT',
  reviewRequired: 'REVIEW_REQUIRED',
});

const BAHRAIN_PHONE_RE = /^\+973\d{8}$/;

export async function classifyProfilePhone({
  profile,
  allProfiles,
  authUsers,
  loadOwnedData,
}) {
  const canonicalPhone = tryNormalizeBahrainPhone(profile.phone);
  const base = {
    canonicalUserId: profile.id,
    phone: canonicalPhone,
    duplicateUserId: null,
  };

  if (!canonicalPhone) {
    return review(base, 'Profile phone is not a valid Bahrain number.');
  }

  const matchingProfiles = allProfiles.filter(
    (candidate) => tryNormalizeBahrainPhone(candidate.phone) === canonicalPhone,
  );
  if (matchingProfiles.length !== 1) {
    return review(base, 'Multiple public profiles share the normalized phone.');
  }

  const canonicalUser = authUsers.find((user) => user.id === profile.id);
  if (!canonicalUser) {
    return review(base, 'Canonical Auth user is missing.');
  }

  const canonicalAuthPhone = tryNormalizeBahrainPhone(canonicalUser.phone);
  if (canonicalUser.phone && !canonicalAuthPhone) {
    return review(base, 'Canonical Auth user has an invalid phone value.');
  }
  if (canonicalAuthPhone && canonicalAuthPhone !== canonicalPhone) {
    return review(base, 'Canonical Auth user owns a different phone.');
  }

  const owners = authUsers.filter((user) => authUserOwnsPhone(user, canonicalPhone));
  const ownerIds = new Set(owners.map((user) => user.id));
  if (ownerIds.size > 1) {
    return review(base, 'Multiple Auth users or identities own the normalized phone.');
  }

  if (canonicalAuthPhone === canonicalPhone) {
    if (
      ownerIds.size === 1 &&
      ownerIds.has(canonicalUser.id) &&
      isPhoneConfirmed(canonicalUser) &&
      authProviders(canonicalUser).has('phone')
    ) {
      return { ...base, state: ReconciliationState.alreadyCorrect, reason: null };
    }
    return review(base, 'Canonical Auth phone state is incomplete or ambiguous.');
  }

  if (!isCanonicalEmailUser(canonicalUser)) {
    return review(base, 'Canonical Auth user is not an unambiguous email account.');
  }

  if (ownerIds.size === 0) {
    return { ...base, state: ReconciliationState.safeAttach, reason: null };
  }

  const duplicateUser = owners[0];
  const duplicateBase = { ...base, duplicateUserId: duplicateUser.id };
  if (duplicateUser.id === canonicalUser.id) {
    return review(duplicateBase, 'Canonical Auth phone ownership is inconsistent.');
  }
  if (!isDisposablePhoneOnlyUser(duplicateUser, canonicalPhone)) {
    return review(duplicateBase, 'Conflicting Auth user is not safely phone-only.');
  }

  const ownedData = await loadOwnedData(duplicateUser.id);
  const nonEmpty = Object.entries(ownedData).filter(([, count]) => count !== 0);
  if (nonEmpty.length > 0) {
    return review(
      duplicateBase,
      `Conflicting Auth user owns Jareb data (${nonEmpty
        .map(([table, count]) => `${table}=${count}`)
        .join(', ')}).`,
    );
  }

  return {
    ...duplicateBase,
    state: ReconciliationState.safeReconcileDuplicate,
    reason: null,
  };
}

export function normalizeBahrainPhone(value) {
  const normalized = tryNormalizeBahrainPhone(value);
  if (!normalized) throw new Error('Invalid Bahrain phone number.');
  return normalized;
}

export function tryNormalizeBahrainPhone(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const compact = value.trim().replace(/[^\d+]/g, '');
  const canonical = compact.startsWith('+')
    ? compact
    : compact.startsWith('973')
      ? `+${compact}`
      : `+973${compact}`;
  return BAHRAIN_PHONE_RE.test(canonical) ? canonical : null;
}

export function maskPhone(value) {
  if (!value) return null;
  return value.replace(/^(\+973)(\d{4})(\d{4})$/, '$1****$3');
}

export function authProviders(user) {
  const providers = new Set();
  const metadataProviders = user.app_metadata?.providers;
  if (Array.isArray(metadataProviders)) {
    for (const provider of metadataProviders) addProvider(providers, provider);
  }
  addProvider(providers, user.app_metadata?.provider);
  for (const identity of user.identities ?? []) addProvider(providers, identity.provider);
  return providers;
}

function authUserOwnsPhone(user, canonicalPhone) {
  if (tryNormalizeBahrainPhone(user.phone) === canonicalPhone) return true;
  return (user.identities ?? []).some(
    (identity) =>
      identity.provider === 'phone' &&
      tryNormalizeBahrainPhone(identity.identity_data?.phone) === canonicalPhone,
  );
}

function isCanonicalEmailUser(user) {
  return (
    typeof user.email === 'string' &&
    user.email.trim() !== '' &&
    authProviders(user).has('email')
  );
}

function isDisposablePhoneOnlyUser(user, canonicalPhone) {
  const providers = authProviders(user);
  return (
    tryNormalizeBahrainPhone(user.phone) === canonicalPhone &&
    (!user.email || user.email.trim() === '') &&
    providers.size === 1 &&
    providers.has('phone')
  );
}

function isPhoneConfirmed(user) {
  return (
    typeof user.phone_confirmed_at === 'string' &&
    user.phone_confirmed_at.trim() !== ''
  );
}

function addProvider(providers, value) {
  if (typeof value === 'string' && value.trim() !== '') providers.add(value.trim());
}

function review(base, reason) {
  return { ...base, state: ReconciliationState.reviewRequired, reason };
}
