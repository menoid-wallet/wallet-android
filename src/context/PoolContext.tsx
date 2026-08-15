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
import { PoolTree, type MerkleProof } from "../lib/merkleTree";
import { useWallet } from "./WalletContext";
import { NETWORK_IDS, type NetworkId } from "../lib/networks";

/* Fast enough that a note arriving feels immediate, which is affordable now
   that a poll only decrypts commitments it has never seen — see the Foreign
   cache in the model. Every one of these is SILENT: background syncing does
   not go through withRefresh, so the numbers never pulse on their own. */
const POLL_MS = 4_000;

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
  /**
   * A Merkle path to one of our own notes, for the spend circuits.
   *
   * Rebuilt locally from the commitment list the backend serves — verified
   * against the chain: for Monad pool 0 at 39 commitments the derived root
   * equalled `pools(0).root` exactly. Returns null if that pool has not been
   * synced yet, which callers must treat as "not ready", never as "no proof".
   */
  getMerkleProof: (network: NetworkId, poolId: string, leafIndex: number) => MerkleProof | null;
  /** The tree root we hold for a pool — compare against the chain before spending. */
  getRoot: (network: NetworkId, poolId: string) => string | null;
  /** Private balance per chain, formatted for display. */
  allBalances: ByNetwork<string>;
  allUTXOs: ByNetwork<UTXO[]>;
  syncing: ByNetwork<boolean>;
  errors: ByNetwork<string | null>;
  /** True until the first pass over every chain has finished. */
  firstSyncDone: boolean;
  /**
   * Resync the pool. `parallel` fires every network at once instead of one at
   * a time — for a refresh the user is watching, where the wait is the whole
   * point and spreading the work only makes them wait longer.
   */
  forceSync: (opts?: { parallel?: boolean }) => Promise<void>;
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
 * Commitments already trial-decrypted and found to belong to SOMEBODY ELSE.
 *
 * This is the other half of the cache and the important one, because failures
 * are the common case: in a shared pool almost every note is a stranger's. Only
 * successes were remembered before, so each poll re-ran an ECDH against every
 * foreign note in every pool, forever — dozens of elliptic-curve operations
 * every ten seconds on the one thread that also draws the UI. That is what made
 * taps land seconds late at random. A note that failed to open once cannot
 * start opening later; the answer is permanent, so cache it.
 */
export type Foreign = Record<string, Set<string>>;

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
  claimed: Claimed,
  foreign: Foreign = {}
): { utxos: UTXO[]; balance: string } {
  const spent = data.spentNullifiers || [];

  for (const pool of data.poolStates || []) {
    const pid = pool.poolId;
    const mine = claimed[pid] || (claimed[pid] = {});
    const theirs = foreign[pid] || (foreign[pid] = new Set());
    const notes = pool.encryptedNotes || {};
    const leafToIndex = pool.leafToIndex || {};

    for (let i = 0; i < (pool.commitments || []).length; i++) {
      const cm = pool.commitments[i];
      const already = mine[cm];
      if (already) {
        already.spent = nullifierIsSpent(already.nullifier, spent);
        continue;
      }
      if (theirs.has(cm)) continue; // already proven to be somebody else's
      const blob = notes[cm];
      if (!blob) continue;

      let note: { amount: string; randomness: string };
      try {
        note = JSON.parse(decryptMessage(blob, keys.privateKey, network));
      } catch {
        // Somebody else's note — the common case, and permanently so.
        theirs.add(cm);
        continue;
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

  /* One tree per network+pool, grown INCREMENTALLY: each sync only inserts the
     commitments it has not seen, so a poll costs the new leaves rather than a
     full rebuild of a tree that can hold a million. Refs, not state — a tree is
     not something the UI renders. */
  const trees = useRef<Record<string, PoolTree>>({});
  const inserted = useRef<Record<string, number>>({});

  /* Rebuilding a depth-20 tree is ~20 poseidon hashes PER LEAF, in pure JS, on
     the one thread that also draws the UI — a first sync over a few dozen
     commitments is long enough to swallow a tap. So the pools are absorbed one
     per frame: the work is the same, but it lands in slices the renderer can
     interleave with, which is what stops the wallet hitching while it syncs.

     THE YIELD IS BETWEEN POOLS, NEVER INSIDE ONE. A half-inserted tree has a
     root that matches nothing, and `getMerkleProof` would hand back a proof the
     contract rejects — far worse than a slow frame. Each pool is all or none. */
  const absorbTrees = useCallback(async (network: NetworkId, pools: any[]) => {
    let n = 0;
    for (const pool of pools || []) {
      /* Raced against a timer on purpose: rAF does not fire while the app is
         backgrounded, and the pool poll keeps running there — a bare rAF would
         leave a sync parked mid-absorb until the app came forward again. */
      if (n++ > 0) {
        await new Promise<void>((r) => {
          let done = false;
          const fin = () => {
            if (!done) {
              done = true;
              r();
            }
          };
          requestAnimationFrame(fin);
          setTimeout(fin, 50);
        });
      }
      const key = `${network}_${pool.poolId}`;
      if (!trees.current[key]) {
        trees.current[key] = new PoolTree();
        inserted.current[key] = 0;
      }
      const tree = trees.current[key];
      const commitments: string[] = pool.commitments || [];
      for (let i = inserted.current[key] ?? 0; i < commitments.length; i++) {
        tree.insert(BigInt(commitments[i]));
      }
      inserted.current[key] = commitments.length;
    }
  }, []);

  const getMerkleProof = useCallback(
    (network: NetworkId, poolId: string, leafIndex: number) =>
      trees.current[`${network}_${poolId}`]?.proof(leafIndex) ?? null,
    []
  );

  const getRoot = useCallback(
    (network: NetworkId, poolId: string) => {
      const t = trees.current[`${network}_${poolId}`];
      return t ? t.root.toString() : null;
    },
    []
  );
  const [syncing, setSyncing] = useState<ByNetwork<boolean>>(() => blank(() => false));
  const [errors, setErrors] = useState<ByNetwork<string | null>>(() =>
    blank<string | null>(() => null)
  );
  const [firstSyncDone, setFirstSyncDone] = useState(false);

  /* ── the caches, all keyed BY ACCOUNT ─────────────────────────────────────
     
     THE POOL IS SHARED; THE READING OF IT IS NOT. Every account sees the same
     commitments on chain — what differs is which of them each account can
     decrypt. So the raw pool state is fetched once per network and reused by
     every account, while the decryption results are kept per account.

     This used to be flat, and switching account threw all of it away: balances
     reset to zero, the whole pool was refetched, and every note was
     trial-decrypted again from scratch. Switching back and forth paid that cost
     every single time, for data that had not changed. Now a switch is a lookup.

     Refs, not state: caches for the next pass. Re-rendering on every note found
     would mean a render per commitment on the first sync of a busy pool. */

  /** Last raw state per network — shared by all accounts. */
  const poolData = useRef<Partial<Record<NetworkId, any>>>({});
  /** account → network → commitment → UTXO */
  const found = useRef<Record<string, ByNetwork<Claimed>>>({});
  /** account → network → notes proven to belong to someone else */
  const strangers = useRef<Record<string, ByNetwork<Foreign>>>({});
  /** account → network → the folded results, so a switch can paint instantly */
  const balanceCache = useRef<Record<string, ByNetwork<string>>>({});
  const utxoCache = useRef<Record<string, ByNetwork<UTXO[]>>>({});

  /** Identity of the account whose numbers are currently on screen. */
  const acctKey = wallet?.noidAccount?.publicKey ?? "";
  const acctRef = useRef(acctKey);
  acctRef.current = acctKey;

  const cachesFor = useCallback((acct: string) => {
    if (!found.current[acct]) found.current[acct] = blank<Claimed>(() => ({}));
    if (!strangers.current[acct]) strangers.current[acct] = blank<Foreign>(() => ({}));
    if (!balanceCache.current[acct]) balanceCache.current[acct] = blank(() => "0.0000");
    if (!utxoCache.current[acct]) utxoCache.current[acct] = blank<UTXO[]>(() => []);
    return {
      claimed: found.current[acct],
      theirs: strangers.current[acct],
      balances: balanceCache.current[acct],
      utxos: utxoCache.current[acct],
    };
  }, []);

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

      const acct = acctRef.current;
      setSyncing((s) => ({ ...s, [network]: true }));
      try {
        const data = await fetchLatestState(network);
        poolData.current[network] = data; // shared: any account can fold this
        await absorbTrees(network, data.poolStates || []);

        const c = cachesFor(acct);
        const { utxos, balance } = foldPoolState(data, keys, network, c.claimed[network], c.theirs[network]);
        c.balances[network] = balance;
        c.utxos[network] = utxos;

        /* Only touch the screen if this is still the account being shown. A
           sync that started before a switch must not paint the old account's
           balance over the new one. */
        if (acctRef.current === acct) {
          setAllUTXOs((p) => ({ ...p, [network]: utxos }));
          setAllBalances((p) => ({ ...p, [network]: balance }));
        }
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

  /* ONE NETWORK AT A TIME, with a frame between them.

     `Promise.all` fired all six at once, so their folds — decryption, poseidon,
     tree inserts — landed back to back in a single burst on the JS thread, and
     anything the user touched during that burst waited for all six. The total
     work is the same either way; spreading it means the renderer gets a turn in
     between, which is the difference between a poll you never notice and a poll
     that eats a tap. Networks are independent, so order does not matter. */
  const forceSync = useCallback(async (opts?: { parallel?: boolean }) => {
    /* A MANUAL refresh runs all six at once. The serialisation below exists so
       a BACKGROUND poll cannot monopolise the JS thread while somebody is
       tapping — but when the tap WAS "reload now", pacing it means the dim
       outlives the number it belongs to. The balance you were watching lands
       first and then sits there greyed out waiting for five other chains, which
       is exactly the second of dead time this avoids. */
    if (opts?.parallel) {
      await Promise.all(NETWORK_IDS.map((n) => syncNetwork(n)));
      setFirstSyncDone(true);
      return;
    }

    for (const n of NETWORK_IDS) {
      await syncNetwork(n);
      await new Promise<void>((r) => {
        let done = false;
        const fin = () => {
          if (!done) {
            done = true;
            r();
          }
        };
        requestAnimationFrame(fin);
        setTimeout(fin, 50); // rAF does not fire in the background
      });
    }
    setFirstSyncDone(true);
  }, [syncNetwork]);

  /**
   * Switching account SHOWS that account, it does not rebuild it.
   *
   * The old version cleared every cache, reset the figures to zero and resynced
   * from scratch on every switch — so going back to an account you had already
   * opened re-fetched the same pool and re-decrypted the same notes to arrive
   * at the number it had just thrown away.
   *
   * Now each account keeps its own results, so a switch paints them
   * immediately. Anything that arrived while you were elsewhere is folded in
   * from the pool state we already hold, WITHOUT a network round trip, and only
   * the commitments this account has never seen are decrypted — the rest are
   * answered from its caches. The regular poll then keeps it current.
   *
   * A brand-new account still has to read the pool once; there is no way around
   * that, since only its keys can tell which notes are its own. But it happens
   * once per account, not once per switch.
   */
  const sessionKey = wallet?.noidAccount?.publicKey ?? null;
  useEffect(() => {
    if (!sessionKey || !isUnlocked) {
      setAllBalances(blank(() => "0.0000"));
      setAllUTXOs(blank<UTXO[]>(() => []));
      return;
    }

    const c = cachesFor(sessionKey);

    /* Paint what this account already knows, this frame. */
    setAllBalances({ ...c.balances });
    setAllUTXOs({ ...c.utxos });
    setErrors(blank<string | null>(() => null));

    /* Then fold anything new out of the pool state already in memory — no
       fetch, and cheap, because seen commitments short-circuit. */
    let cancelled = false;
    void (async () => {
      for (const network of NETWORK_IDS) {
        const data = poolData.current[network];
        const keys = noidFor(network);
        if (!data || !keys?.privateKey || !keys?.zkSecretKey) continue;
        const { utxos, balance } = foldPoolState(
          data,
          keys,
          network,
          c.claimed[network],
          c.theirs[network]
        );
        c.balances[network] = balance;
        c.utxos[network] = utxos;
        if (cancelled || acctRef.current !== sessionKey) return;
        setAllBalances((p) => ({ ...p, [network]: balance }));
        setAllUTXOs((p) => ({ ...p, [network]: utxos }));
      }
      if (!cancelled) setFirstSyncDone(true);
      /* One fetch to catch whatever landed since the last poll. Silent. */
      if (!cancelled) void forceSync();
    })();

    return () => {
      cancelled = true;
    };
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
    () => ({ allBalances, allUTXOs, syncing, errors, firstSyncDone, forceSync, getMerkleProof, getRoot }),
    [allBalances, allUTXOs, syncing, errors, firstSyncDone, forceSync, getMerkleProof, getRoot]
  );

  return <PoolContext.Provider value={value}>{children}</PoolContext.Provider>;
}

export function usePool(): PoolContextValue {
  const ctx = useContext(PoolContext);
  if (!ctx) throw new Error("usePool must be used within a PoolProvider");
  return ctx;
}
