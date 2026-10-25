import { describe, expect, it, vi } from 'vitest';

import { dispatchPushEvents } from '../src/services/push-events';

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const sent: { token: string; type: string; data: Record<string, string> }[] = [];

vi.mock('../src/services/supabase', () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let upsertRow: Row | undefined;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
        lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        order: () => q,
        range: () => q,
        limit: () => q,
        upsert: (row: Row) => ((upsertRow = row), q),
        then(resolve: (v: unknown) => void) {
          if (upsertRow) {
            const log = (tables[table] ??= []);
            const dup = log.some(
              (r) => r.kind === upsertRow!.kind && r.ref_id === upsertRow!.ref_id,
            );
            if (!dup) log.push(upsertRow);
            return resolve({ data: dup ? [] : [upsertRow], error: null });
          }
          return resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return q;
    },
  }),
}));

const bindings = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
};
const client = {
  send: async (token: string, message: { data: Record<string, string> }) => {
    sent.push({ token, type: message.data.type, data: message.data });
    return { accepted: true, invalidToken: false };
  },
};

describe('dispatchPushEvents', () => {
  it('sends each event once and ignores old ones', async () => {
    const now = new Date('2026-10-21T12:00:00Z');
    tables.push_devices = [
      { id: 'd1', user_id: 'u1', fcm_token: 't1', platform: 'android', notifications_enabled: true },
      { id: 'd2', user_id: 'u2', fcm_token: 't2', platform: 'ios', notifications_enabled: true },
    ];
    tables.drops = [
      { id: 'new', title: 'Fresh', is_active: true, start_date: '2026-10-21T10:00:00Z', end_date: '2026-10-30T00:00:00Z' },
      { id: 'old', title: 'Old', is_active: true, start_date: '2026-10-01T10:00:00Z', end_date: '2026-10-30T00:00:00Z' },
    ];
    tables.claims = [
      { id: 'c1', user_id: 'u1', status: 'claimed', claim_expires_at: '2026-10-22T06:00:00Z' },
      { id: 'c2', user_id: 'u2', status: 'approved', approved_at: '2026-10-21T09:00:00Z' },
      { id: 'c3', user_id: 'u2', status: 'paid', paid_at: '2026-10-21T11:00:00Z' },
      { id: 'c4', user_id: 'u1', status: 'paid', paid_at: '2026-09-01T11:00:00Z' },
    ];

    const first = await dispatchPushEvents({ bindings, now, client });
    expect(first).toEqual({
      drop_live: 1,
      claim_expiring: 1,
      cashback_approved: 1,
      cashback_paid: 1,
    });
    expect(sent.filter((s) => s.type === 'drop_live')).toHaveLength(2);
    expect(sent.find((s) => s.type === 'claim_expiring')).toMatchObject({
      token: 't1',
      data: { claim_id: 'c1' },
    });

    const before = sent.length;
    const second = await dispatchPushEvents({ bindings, now, client });
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
    expect(sent).toHaveLength(before);
  });
});
