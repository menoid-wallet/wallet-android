/**
 * PoolContext.tsx — the private (noid) balances.
 *
 * Ported from the extension's context/PoolContext.tsx. Every ten seconds, for
 * every chain:
 *
 *   1. GET /state/:network/latest — the pool's commitments, the encrypted note
 *      behind each one, and the nullifiers that have been spent.
 *   2. Try to ECIES-decrypt each note we have not already claimed. The ones
 *      that open are ours; that is the only way to find your own money in a
 *      shielded pool, and it is why this is a poll and not a balance query.
 *   3. Derive each note's nullifier and drop it if the chain has seen it.
 *   4. Sum what is left.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE EXTENSION:
 *
 * - NO MERKLE TREE. The extension builds an IncrementalMerkleTree per pool as
 *   it goes. Nothing in the balance needs it — it exists to produce membership
 *   proofs for mask/unmask/transfer, and those are not built yet. Carrying it
 *   would mean @zk-kit/incremental-merkle-tree and circomlibjs (a WASM/asm
 *   build) on the phone for a value nothing reads. When the proofs land, the
 *   tree comes with them.
 *
 * - Poseidon is `poseidon-lite`, not circomlibjs — same constants, same
 *   permutation, no WASM. Already how keyDerivation computes the user
 *   commitment, so the two halves agree by construction.
 *
 * Decryption is real work (an ECDH per candidate note), so notes already
 * matched are kept and only NEW commitments are attempted on each pass.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";
import { decryptMessage } from "../crypto/ecies";
import { fetchLatestState } from "../services/api";
import { useWallet } from "./WalletContext";
import { NETWORK_IDS, type NetworkId } from "../lib/networks";

const POLL_MS = 10_000;

export interface UTXO {
  commitment: string;
  /** smallest unit, decimal string */
  amount: string;
  randomness: string;
  leafIndex: number;
  nullifier: string;
  spent: boolean;
  poolId: string;
}

type ByNetwork<T> = Record<NetworkId, T>;

const blank = <T,>(v: () => T): ByNetwork<T> =>
  NETWORK_IDS.reduce((acc, n) => {
    acc[n] = v();
    return acc;
  }, {} as ByNetwork<T>);

interface PoolContextValue {
  /** Private balance per chain, formatted for display. */
  allBalances: ByNetwork<string>;
  allUTXOs: ByNetwork<UTXO[]>;
  syncing: ByNetwork<boolean>;
  errors: ByNetwork<string | null>;
  /** True until the first pass over every chain has finished. */
  firstSyncDone: boolean;
  forceSync: () => Promise<void>;
}

const PoolContext = createContext<PoolContextValue | null>(null);

function decimalsFor(network: NetworkId): number {
  if (network === "solana" || network === "sui") return 9;
  if (network === "aptos") return 8;
  return 18;
}

function formatBalance(units: bigint, network: NetworkId): string {
  if (units === 0n) return "0.0000";
  const n = Number(ethers.formatUnits(units, decimalsFor(network)));
  if (!Number.isFinite(n) || n === 0) return "0.0000";
  return n < 0.0001 ? n.toFixed(6) : n.toFixed(4);
}

/** The chain sends spent nullifiers in whatever shape it stores them. */
function nullifierIsSpent(nullifier: string, spent: string[]): boolean {
  if (!nullifier || spent.length === 0) return false;
  if (spent.includes(nullifier)) return true;
  try {
    const v = BigInt(nullifier);
    if (spent.includes(v.toString())) return true;
    const hex = ethers.zeroPadValue(ethers.toBeHex(v), 32);
    if (spent.includes(hex) || spent.includes(hex.toLowerCase())) return true;
  } catch {
    /* not numeric — the direct compare above was the only chance */
  }
  return false;
}

/** What a chain's notes look like after a pass. Keyed poolId → commitment. */
export type Claimed = Record<string, Record<string, UTXO>>;

/**
 * THE WHOLE BALANCE, as a pure function — deliberately outside the component so
 * it can be tested against real pool data without a renderer (see
 * scripts/verify-pool-fold.cjs). Mutates `claimed`, which is the per-chain
 * cache of notes already opened: decryption is an ECDH per candidate, and
 * re-trying every note in the pool on every ten-second poll would be the most
 * expensive thing the app does.
 */
export function foldPoolState(
  data: { spentNullifiers?: string[]; poolStates?: any[] },
  keys: { privateKey: string; zkSecretKey: string },
  network: NetworkId,
  claimed: Claimed
): { utxos: UTXO[]; balance: string } {
  const spent = data.spentNullifiers || [];

  for (const pool of data.poolStates || []) {
    const pid = pool.poolId;
    const mine = claimed[pid] || (claimed[pid] = {});
    const notes = pool.encryptedNotes || {};
    const leafToIndex = pool.leafToIndex || {};

    for (let i = 0; i < (pool.commitments || []).length; i++) {
      const cm = pool.commitments[i];
      const already = mine[cm];
      if (already) {
        already.spent = nullifierIsSpent(already.nullifier, spent);
        continue;
      }
      const blob = notes[cm];
      if (!blob) continue;

      let note: { amount: string; randomness: string };
      try {
        note = JSON.parse(decryptMessage(blob, keys.privateKey, network));
      } catch {
        continue; // somebody else's note — the common case
      }

      /* nullifier = Poseidon(2, commitment, randomness, spendKey). The leading
         2 is the scheme's domain tag and the circuits use the same one, so a
         nullifier computed here matches the one the chain will see when this
         note is eventually spent. */
      const nBig = poseidon4([2n, BigInt(cm), BigInt(note.randomness), BigInt(keys.zkSecretKey)]);
      const nullifier = ethers.zeroPadValue(ethers.toBeHex(nBig), 32);

      mine[cm] = {
        commitment: cm,
        amount: note.amount,
        randomness: note.randomness,
        leafIndex: leafToIndex[cm] ?? i,
        nullifier,
        spent: nullifierIsSpent(nullifier, spent),
        poolId: pid,
      };
    }
  }

  const utxos = Object.values(claimed)
    .flatMap((byCm) => Object.values(byCm))
    .filter((u) => !u.spent);
  const total = utxos.reduce((sum, u) => sum + BigInt(u.amount), 0n);
  return { utxos, balance: formatBalance(total, network) };
}

export function PoolProvider({ children }: { children: React.ReactNode }) {
  const { wallet, isUnlocked } = useWallet();

  const [allBalances, setAllBalances] = useState<ByNetwork<string>>(() => blank(() => "0.0000"));
  const [allUTXOs, setAllUTXOs] = useState<ByNetwork<UTXO[]>>(() => blank<UTXO[]>(() => []));
  const [syncing, setSyncing] = useState<ByNetwork<boolean>>(() => blank(() => false));
  const [errors, setErrors] = useState<ByNetwork<string | null>>(() =>
    blank<string | null>(() => null)
  );
  const [firstSyncDone, setFirstSyncDone] = useState(false);

  /* commitment → UTXO, per network per pool. A ref, not state: it is a cache
     for the NEXT pass, and re-rendering on every note found would mean a render
     per commitment on the first sync of a busy pool. */
  const found = useRef<ByNetwork<Claimed>>(blank<Claimed>(() => ({})));

  /** The noid (private) identity for a chain — the key notes are encrypted to. */
  const noidFor = useCallback(
    (network: NetworkId) => {
      if (!wallet) return undefined;
      if (network === "solana") return wallet.solanaNoidAccount;
      if (network === "sui") return wallet.suiNoidAccount;
      if (network === "aptos") return wallet.aptosNoidAccount;
      return wallet.noidAccount;
    },
    [wallet]
  );

  const syncNetwork = useCallback(
    async (network: NetworkId) => {
      const keys = noidFor(network);
      if (!keys?.privateKey || !keys?.zkSecretKey) return;

      setSyncing((s) => ({ ...s, [network]: true }));
      try {
        const data = await fetchLatestState(network);
        const claimed = found.current[network] || (found.current[network] = {});
        const { utxos, balance } = foldPoolState(data, keys, network, claimed);
        setAllUTXOs((p) => ({ ...p, [network]: utxos }));
        setAllBalances((p) => ({ ...p, [network]: balance }));
        setErrors((p) => ({ ...p, [network]: null }));
      } catch (e: any) {
        console.error(`[PoolContext] sync failed for ${network}:`, e);
        setErrors((p) => ({ ...p, [network]: e?.message ?? "Sync failed" }));
      } finally {
        setSyncing((s) => ({ ...s, [network]: false }));
      }
    },
    [noidFor]
  );

  const forceSync = useCallback(async () => {
    await Promise.all(NETWORK_IDS.map((n) => syncNetwork(n)));
    setFirstSyncDone(true);
  }, [syncNetwork]);

  /* A different wallet is a different set of notes — everything found for the
     old one has to go, or account 2 inherits account 1's balance. */
  const sessionKey = wallet?.noidAccount?.publicKey ?? null;
  useEffect(() => {
    found.current = blank<Claimed>(() => ({}));
    setAllBalances(blank(() => "0.0000"));
    setAllUTXOs(blank<UTXO[]>(() => []));
    setErrors(blank<string | null>(() => null));
    setFirstSyncDone(false);
    if (sessionKey && isUnlocked) void forceSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, isUnlocked]);

  useEffect(() => {
    if (!sessionKey || !isUnlocked) return;
    const id = setInterval(() => {
      if (AppState.currentState === "active") void forceSync();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [sessionKey, isUnlocked, forceSync]);

  const value = useMemo<PoolContextValue>(
    () => ({ allBalances, allUTXOs, syncing, errors, firstSyncDone, forceSync }),
    [allBalances, allUTXOs, syncing, errors, firstSyncDone, forceSync]
  );

  return <PoolContext.Provider value={value}>{children}</PoolContext.Provider>;
}

export function usePool(): PoolContextValue {
  const ctx = useContext(PoolContext);
  if (!ctx) throw new Error("usePool must be used within a PoolProvider");
  return ctx;
}
