/**
 * txStore.ts — the ship's log.
 *
 * Ported from the extension's lib/txStore.ts, trimmed to the open-mode half
 * (the noid stores land with noid mode). Two things had to change:
 *
 *   - localStorage is synchronous; AsyncStorage is not. So the entries are held
 *     in a module-level CACHE that the UI reads synchronously, and the write to
 *     disk is fire-and-forget behind it. A log row must appear the instant a
 *     send returns — not one round trip later.
 *   - there is no window to dispatch an event on, so subscribers are a plain
 *     listener set.
 *
 * KEYED BY SENDER **AND NETWORK**, capped at 50 entries, newest first. The
 * address alone is not enough: Monad, Sepolia and Base Sepolia are all signed by
 * the same EVM account, so an address-only key gave the three of them one shared
 * log and a send on Monad turned up in Sepolia's ship's log and Base's as well.
 * The ADDRESS BOOK is the opposite and deliberately wide — see
 * `recentRecipients`, which spans every account and every chain.
 */

import { getItem, setItem } from "./storage";
import { NETWORKS, type NetworkId } from "./networks";

export interface OpenTxEntry {
  type: "open";
  /** Which chain this went out on. Redundant with the key, kept for debugging. */
  network?: NetworkId;
  txHash: string;
  gasUsed: string | null;
  to: string | null;
  /** hex wei (or the chain's smallest unit) */
  value: string | null;
  functionName: string | null;
  timestamp: number;
}

/** Mask: money leaving the public balance and entering the pool. */
export interface MaskEntry {
  type: "mask";
  network?: NetworkId;
  txHash: string;
  /** the open address it was taken from */
  fromAddress: string;
  /** the noid identity that received the note */
  noidPublicKey: string;
  /** decimal amount hidden, and the relayer's cut */
  amountMon: string;
  feeMon: string;
  timestamp: number;
}

export type TxEntry = OpenTxEntry | MaskEntry;

const MAX = 50;

function openKey(address: string, network: NetworkId) {
  return `openaccount:${address.toLowerCase()}:${network}`;
}

/* Synchronous mirror of what is on disk. Populated by hydrateOpenTxns() and
   kept in step by every write, so reads never have to await. */
const cache: Record<string, TxEntry[]> = {};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeTxns(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a bad subscriber must not take the others down */
    }
  });
}

function persist(key: string) {
  void setItem(key, cache[key] ?? []);
}

/* ── Rescuing logs written before the key carried a network ──
   Those live under `openaccount:<address>` with nothing saying which chain they
   went out on. For Solana, Sui and Aptos there is no question — the address
   belongs to exactly one chain, so the whole log is that chain's. For the three
   EVM networks, which are one account, the only source of truth is the chains
   themselves: ask each one whether it has the hash. The legacy key is left
   where it is rather than deleted, because the other two EVM chains have not
   had their turn to claim from it yet. */
const EVM_NETWORKS: NetworkId[] = ["monad", "sepolia", "base_sepolia"];

function legacyKey(address: string) {
  return `openaccount:${address.toLowerCase()}`;
}

/** true / false / null, where null means no endpoint would answer. */
async function evmHasTx(network: NetworkId, txHash: string): Promise<boolean | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 6000);
  try {
    for (const url of NETWORKS[network].rpcUrls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getTransactionByHash",
            params: [txHash],
          }),
          signal: stop.signal,
        });
        const json = await res.json();
        if (json?.error) continue;
        return json?.result != null;
      } catch {
        /* try the next endpoint */
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The entries this chain owns, or null if the chains could not be asked. */
async function claimLegacy(
  address: string,
  network: NetworkId
): Promise<OpenTxEntry[] | null> {
  const legacy = await getItem<OpenTxEntry[]>(legacyKey(address));
  if (!Array.isArray(legacy) || legacy.length === 0) return [];
  if (!EVM_NETWORKS.includes(network)) return legacy;
  const mine: OpenTxEntry[] = [];
  for (const e of legacy) {
    const has = await evmHasTx(network, e.txHash);
    // Unreachable is NOT "not mine". Answering false here would let one flaky
    // moment throw the entry away for good, since the empty result gets written
    // and the probe never runs again.
    if (has === null) return null;
    if (has) mine.push(e);
  }
  return mine;
}

/** Read this sender's log ON THIS CHAIN into the cache. Safe to call repeatedly. */
export async function hydrateOpenTxns(
  address: string,
  network: NetworkId
): Promise<OpenTxEntry[]> {
  const key = openKey(address, network);
  if (cache[key]) return cache[key] as OpenTxEntry[]; // [] is truthy — one hydrate per chain
  const stored = await getItem<OpenTxEntry[]>(key);
  if (Array.isArray(stored)) {
    cache[key] = stored;
    notify();
    return stored;
  }

  /* Nothing under the network key: first look since the key gained one. Seed
     the cache before awaiting so a second caller does not probe in parallel,
     then write whatever we end up with — including an empty log, which is what
     stops the probe running again on every open. */
  cache[key] = [];
  notify();
  const rescued = await claimLegacy(address, network);
  if (rescued === null) {
    // Couldn't ask. Forget we looked, so the next open tries again.
    delete cache[key];
    return [];
  }
  if (rescued.length) cache[key] = rescued.map((e) => ({ ...e, network }));
  persist(key);
  notify();
  return cache[key] as OpenTxEntry[];
}

/** Synchronous read — whatever hydrate last put in the cache. */
export function loadOpenTxns(address: string, network: NetworkId): OpenTxEntry[] {
  return (cache[openKey(address, network)] ?? []) as OpenTxEntry[];
}

/* ── The private log ──
   Keyed by the NOID identity rather than the open address, because that is what
   owns the note — the same split the extension makes. Per-chain for the same
   reason the open log is: one EVM key signs on three chains. */
function maskKey(noidPublicKey: string, network: NetworkId) {
  return `noidmask:${noidPublicKey.toLowerCase()}:${network}`;
}

export async function hydrateMaskTxns(
  noidPublicKey: string,
  network: NetworkId
): Promise<MaskEntry[]> {
  const key = maskKey(noidPublicKey, network);
  if (cache[key]) return cache[key] as MaskEntry[];
  const stored = await getItem<MaskEntry[]>(key);
  cache[key] = Array.isArray(stored) ? stored : [];
  notify();
  return cache[key] as MaskEntry[];
}

export function loadMaskTxns(noidPublicKey: string, network: NetworkId): MaskEntry[] {
  return (cache[maskKey(noidPublicKey, network)] ?? []) as MaskEntry[];
}

export function saveMaskTx(noidPublicKey: string, network: NetworkId, tx: MaskEntry): void {
  const key = maskKey(noidPublicKey, network);
  cache[key] = [{ ...tx, network }, ...(cache[key] ?? [])].slice(0, MAX);
  persist(key);
  notify();
}

export interface RecentRecipient {
  address: string;
  lastAt: number;
}

/**
 * Everyone this WALLET has paid, most recent first.
 *
 * THE ADDRESS BOOK IS WALLET-WIDE — not per account, and not per chain. The
 * ship's log is deliberately narrow, because a Monad send belongs in Monad's
 * log and nowhere else. "Who have I paid before" is the opposite question:
 * someone you sent to from account 1 is still someone you know when you are
 * sending from account 2, and retyping their address because you switched
 * accounts is the exact friction this list exists to remove.
 *
 * Only logs that have been read off disk are in the cache to be scanned, so
 * call `hydrateAddressBook` first.
 */
export function recentRecipients(limit = 8): RecentRecipient[] {
  const seen = new Map<string, number>();
  for (const key of Object.keys(cache)) {
    if (!key.startsWith("openaccount:")) continue; // mask rows live under noidmask:
    for (const e of cache[key]) {
      if (e.type !== "open" || !e.to) continue;
      const at = seen.get(e.to);
      if (at === undefined || e.timestamp > at) seen.set(e.to, e.timestamp);
    }
  }
  return Array.from(seen, ([addr, lastAt]) => ({ address: addr, lastAt }))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit);
}

/**
 * Pull every account's log, on every chain, into the cache so the address book
 * above can see them. Cheap after the first pass — `hydrateOpenTxns`
 * short-circuits on anything already cached.
 */
export async function hydrateAddressBook(addresses: string[]): Promise<void> {
  const nets = Object.keys(NETWORKS) as NetworkId[];
  await Promise.all(
    addresses
      .filter(Boolean)
      .flatMap((a) => nets.map((n) => hydrateOpenTxns(a, n).catch(() => [])))
  );
}

export function saveOpenTx(address: string, network: NetworkId, tx: OpenTxEntry): void {
  const key = openKey(address, network);
  cache[key] = [{ ...tx, network }, ...(cache[key] ?? [])].slice(0, MAX);
  persist(key);
  notify();
}

/** Patch an entry in place, matched on txHash — used to fill gasUsed in later. */
export function updateOpenTx(
  address: string,
  network: NetworkId,
  txHash: string,
  patch: Partial<OpenTxEntry>
): void {
  const key = openKey(address, network);
  const entries = cache[key];
  if (!entries) return;
  const idx = entries.findIndex((e) => e.txHash === txHash);
  if (idx === -1) return;
  const row = entries[idx];
  if (row.type !== "open") return;
  entries[idx] = { ...row, ...patch };
  persist(key);
  notify();
}
