import type { SupabaseClient } from '@supabase/supabase-js';

import { getFirebaseMessagingConfig, getSupabaseServiceConfig } from '../config/env';
import {
  createFirebasePushClient,
  type FirebasePushClient,
  type PushNotificationType,
} from '../integrations/firebase/push';
import type { Bindings } from '../types/app';
import { broadcastPushToActiveDevices, sendPushToUser } from './push-notifications';
import { createSupabaseServiceClient } from './supabase';

const HOUR_MS = 60 * 60 * 1000;
// Events older than this are never announced, so a first deploy or an outage
// cannot replay history to customers.
const LOOKBACK_MS = 24 * HOUR_MS;
const EXPIRY_WARNING_MS = 24 * HOUR_MS;
const BATCH_LIMIT = 200;

type ScheduledPushNotificationType = Exclude<PushNotificationType, 'test'>;

export type PushEventSummary = Record<ScheduledPushNotificationType, number>;

type Ref = { id: string; user_id?: string };

// Inserts the ledger row first; only the run that wins the insert may send.
async function claimEvent(
  supabase: SupabaseClient,
  kind: PushNotificationType,
  refId: string,
) {
  const { data, error } = await supabase
    .from('push_event_log')
    .upsert({ kind, ref_id: refId }, { onConflict: 'kind,ref_id', ignoreDuplicates: true })
    .select('ref_id');
  if (error) throw new Error(`push_event_log insert failed: ${error.code}`);
  return (data ?? []).length > 0;
}

async function loggedIds(
  supabase: SupabaseClient,
  kind: PushNotificationType,
  ids: string[],
) {
  if (ids.length === 0) return new Set<string>();
  const { data, error } = await supabase
    .from('push_event_log')
    .select('ref_id')
    .eq('kind', kind)
    .in('ref_id', ids);
  if (error) throw new Error(`push_event_log read failed: ${error.code}`);
  return new Set((data ?? []).map((row: { ref_id: string }) => row.ref_id));
}

async function unannounced(
  supabase: SupabaseClient,
  kind: PushNotificationType,
  rows: Ref[],
) {
  const seen = await loggedIds(
    supabase,
    kind,
    rows.map((row) => row.id),
  );
  return rows.filter((row) => !seen.has(row.id));
}

export async function dispatchPushEvents({
  bindings,
  now = new Date(),
  client,
}: {
  bindings: Bindings;
  now?: Date;
  client?: FirebasePushClient;
}): Promise<PushEventSummary> {
  const supabase = createSupabaseServiceClient(getSupabaseServiceConfig(bindings));
  const pushClient =
    client ?? createFirebasePushClient({ config: getFirebaseMessagingConfig(bindings) });
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const summary: PushEventSummary = {
    drop_live: 0,
    claim_expiring: 0,
    cashback_approved: 0,
    cashback_paid: 0,
  };

  // Drops that went live recently.
  {
    const { data, error } = await supabase
      .from('drops')
      .select('id, title')
      .eq('is_active', true)
      .lte('start_date', nowIso)
      .gt('start_date', since)
      .gt('end_date', nowIso)
      .limit(BATCH_LIMIT);
    if (error) throw new Error(`drops read failed: ${error.code}`);
    const drops = (data ?? []) as { id: string; title: string }[];
    for (const drop of await unannounced(supabase, 'drop_live', drops)) {
      if (!(await claimEvent(supabase, 'drop_live', drop.id))) continue;
      const title = drops.find((d) => d.id === drop.id)?.title ?? 'A new Drop';
      await broadcastPushToActiveDevices({
        bindings,
        client: pushClient,
        message: {
          title: 'A new Drop is live',
          body: title,
          data: { type: 'drop_live', drop_id: drop.id },
        },
      });
      summary.drop_live += 1;
    }
  }

  // Claims whose reservation expires within 24 hours.
  {
    const { data, error } = await supabase
      .from('claims')
      .select('id, user_id, drop_id')
      .eq('status', 'claimed')
      .gt('claim_expires_at', nowIso)
      .lte('claim_expires_at', new Date(now.getTime() + EXPIRY_WARNING_MS).toISOString())
      .limit(BATCH_LIMIT);
    if (error) throw new Error(`claims read failed: ${error.code}`);
    const claims = (data ?? []) as { id: string; user_id: string; drop_id: string }[];
    for (const claim of await unannounced(supabase, 'claim_expiring', claims)) {
      if (!(await claimEvent(supabase, 'claim_expiring', claim.id))) continue;
      const full = claims.find((c) => c.id === claim.id)!;
      await sendPushToUser({
        bindings,
        client: pushClient,
        userId: full.user_id,
        message: {
          title: 'Your reward is about to expire',
          body: 'Complete your claim before it expires.',
          data: { type: 'claim_expiring', claim_id: full.id },
        },
      });
      summary.claim_expiring += 1;
    }
  }

  // Cashback approved / paid.
  for (const [kind, status, column, title, body] of [
    [
      'cashback_approved',
      'approved',
      'approved_at',
      'Cashback approved',
      'Your cashback has been approved.',
    ],
    ['cashback_paid', 'paid', 'paid_at', 'Cashback paid', 'Your cashback has been paid.'],
  ] as const) {
    const { data, error } = await supabase
      .from('claims')
      .select('id, user_id')
      .eq('status', status)
      .gt(column, since)
      .limit(BATCH_LIMIT);
    if (error) throw new Error(`claims read failed: ${error.code}`);
    const claims = (data ?? []) as { id: string; user_id: string }[];
    for (const claim of await unannounced(supabase, kind, claims)) {
      if (!(await claimEvent(supabase, kind, claim.id))) continue;
      const full = claims.find((c) => c.id === claim.id)!;
      await sendPushToUser({
        bindings,
        client: pushClient,
        userId: full.user_id,
        message: { title, body, data: { type: kind, claim_id: full.id } },
      });
      summary[kind] += 1;
    }
  }

  return summary;
}
