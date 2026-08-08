/**
 * api.ts — the Menoid backend.
 *
 * Ported from the extension's services/api.ts. Same routes, same DTOs; only the
 * env prefix changed (see lib/config).
 */

import { API_BASE } from "../lib/config";
import type { NetworkId } from "../lib/networks";

export const BASE_URL = API_BASE;

export interface PoolStateDTO {
  poolId: string;
  commitments: string[];
  /** commitment → ECIES ciphertext. Serialised as an object over the wire. */
  encryptedNotes: Record<string, string>;
  roots: string[];
  latestRoot: string | null;
  leafToIndex?: Record<string, number>;
  lastProcessedBlock: number;
}

export interface LatestStateDTO {
  network: NetworkId;
  spentNullifiers: string[];
  poolStates: PoolStateDTO[];
  NoidAccountStates: Array<{
    noidAccountAddress: string;
    ownerCommitment: string;
    encryptedNote: string;
  }>;
}

/** GET /api/state/:network/latest */
export async function fetchLatestState(network: NetworkId): Promise<LatestStateDTO> {
  const res = await fetch(`${BASE_URL}/state/${network}/latest`);
  if (!res.ok) throw new Error(`State fetch failed (${res.status}) for ${network}`);
  return res.json();
}
