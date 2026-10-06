import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseAuthConfig } from '../config/env';
import { AppError } from '../errors/app-error';
import {
  hydrateCustomerDropDtos,
  loadCustomerDrop,
  type DropDto,
  type DropRow,
} from './rewards';
import { createSupabaseUserClient } from './supabase';
import type { Bindings } from '../types/app';

type SavedDropRow = {
  user_id: string;
  drop_id: string;
  created_at: string;
};

export type SavedDropDto = {
  savedAt: string;
  drop: DropDto;
};

export type SavedDropsServiceContext = {
  accessToken: string;
  bindings: Bindings;
  userId: string;
};

export type SavedDropsService = {
  listSavedDrops(
    context: SavedDropsServiceContext,
  ): Promise<{ savedDrops: SavedDropDto[]; serverNow: string }>;
  saveDrop(
    context: SavedDropsServiceContext & { dropId: string },
  ): Promise<{ savedDrop: SavedDropDto; serverNow: string }>;
  unsaveDrop(
    context: SavedDropsServiceContext & { dropId: string },
  ): Promise<{ deleted: true; dropId: string }>;
};

function createClient({ accessToken, bindings }: SavedDropsServiceContext) {
  return createSupabaseUserClient({
    ...getSupabaseAuthConfig(bindings),
    accessToken,
  });
}

export const savedDropsService: SavedDropsService = {
  async listSavedDrops(context) {
    const supabase = createClient(context);
    const serverNow = new Date().toISOString();
    const rows = await loadSavedDropRows({ supabase, userId: context.userId });

    return {
      savedDrops: await hydrateSavedDrops({ rows, supabase, serverNow }),
      serverNow,
    };
  },

  async saveDrop(context) {
    const supabase = createClient(context);
    const serverNow = new Date().toISOString();
    const dropRow = await loadCustomerDrop({
      dropId: context.dropId,
      supabase,
    });
    const existing = await loadSavedDropRow({
      dropId: context.dropId,
      supabase,
      userId: context.userId,
    });
    const row =
      existing ??
      (await insertSavedDropRow({
        dropId: context.dropId,
        supabase,
        userId: context.userId,
      }));
    const [drop] = await hydrateCustomerDropDtos({
      rows: [dropRow],
      supabase,
      serverNow,
    });

    if (!drop) {
      throw new AppError(404, 'DROP_NOT_FOUND', 'Drop not found.');
    }

    return {
      savedDrop: {
        savedAt: row.created_at,
        drop,
      },
      serverNow,
    };
  },

  async unsaveDrop(context) {
    const supabase = createClient(context);
    const { error } = await supabase
      .from('saved_drops')
      .delete()
      .eq('user_id', context.userId)
      .eq('drop_id', context.dropId);

    if (error) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Could not unsave drop.');
    }

    return { deleted: true, dropId: context.dropId };
  },
};

async function loadSavedDropRows({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('saved_drops')
    .select('user_id, drop_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load saved drops.');
  }

  return (data ?? []) as SavedDropRow[];
}

async function loadSavedDropRow({
  dropId,
  supabase,
  userId,
}: {
  dropId: string;
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('saved_drops')
    .select('user_id, drop_id, created_at')
    .eq('user_id', userId)
    .eq('drop_id', dropId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not load saved drop.');
  }

  return data as SavedDropRow | null;
}

async function insertSavedDropRow({
  dropId,
  supabase,
  userId,
}: {
  dropId: string;
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('saved_drops')
    .insert({
      user_id: userId,
      drop_id: dropId,
    })
    .select('user_id, drop_id, created_at')
    .single();

  if (error) {
    const existing = await loadSavedDropRow({ dropId, supabase, userId });
    if (existing) return existing;

    throw new AppError(500, 'INTERNAL_ERROR', 'Could not save drop.');
  }

  return data as SavedDropRow;
}

async function hydrateSavedDrops({
  rows,
  supabase,
  serverNow,
}: {
  rows: SavedDropRow[];
  supabase: SupabaseClient;
  serverNow: string;
}) {
  const savedDrops = await Promise.all(
    rows.map(async (row) => {
      try {
        const dropRow = await loadCustomerDrop({
          dropId: row.drop_id,
          supabase,
        });
        const [drop] = await hydrateCustomerDropDtos({
          rows: [dropRow],
          supabase,
          serverNow,
        });

        return drop
          ? {
              savedAt: row.created_at,
              drop,
            }
          : null;
      } catch (error) {
        if (error instanceof AppError && error.code === 'DROP_NOT_FOUND') {
          return null;
        }

        throw error;
      }
    }),
  );

  return sortSavedDrops(
    savedDrops.filter((savedDrop): savedDrop is SavedDropDto => savedDrop !== null),
  );
}

export function sortSavedDrops(savedDrops: SavedDropDto[]) {
  return [...savedDrops].sort((left, right) => {
    const leftClaimable = left.drop.viewer.canClaim;
    const rightClaimable = right.drop.viewer.canClaim;

    if (leftClaimable !== rightClaimable) {
      return leftClaimable ? -1 : 1;
    }

    return right.savedAt.localeCompare(left.savedAt);
  });
}
