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
 * The address book is still shared across them on purpose — see
 * `recentRecipients`, which reads across every network for one sender.
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

export type TxEntry = OpenTxEntry;

const MAX = 50;

function openKey(address: string, network: NetworkId) {
  return `openaccount:${address.toLowerCase()}:${network}`;
}

/** The prefix every one of a sender's per-network logs shares. */
function senderPrefix(address: string) {
  return `openaccount:${address.toLowerCase()}:`;
}

/* Synchronous mirror of what is on disk. Populated by hydrateOpenTxns() and
   kept in step by every write, so reads never have to await. */
const cache: Record<string, OpenTxEntry[]> = {};

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
  if (cache[key]) return cache[key]; // [] is truthy — one hydrate per chain
  const stored = await getItem<OpenTxEntry[]>(key);
  if (Array.isArray(stored)) {
    cache[key] = stored;
    notify();
    return cache[key];
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
  return cache[key];
}

/** Synchronous read — whatever hydrate last put in the cache. */
export function loadOpenTxns(address: string, network: NetworkId): OpenTxEntry[] {
  return cache[openKey(address, network)] ?? [];
}

export interface RecentRecipient {
  address: string;
  lastAt: number;
}

/**
 * Distinct addresses this sender has paid, most recent first.
 *
 * Deliberately reads ACROSS networks for the one sender: the ship's log is
 * per-chain but the address book is not, so the three EVM networks — which are
 * one account — offer each other's recipients, while Solana, Sui and Aptos each
 * have their own address and are separated for free. Only hydrated chains can
 * contribute, which in practice means the one you are sending from plus any you
 * have already visited this session.
 */
export function recentRecipients(address: string, limit = 8): RecentRecipient[] {
  const prefix = senderPrefix(address);
  const seen = new Map<string, number>();
  for (const key of Object.keys(cache)) {
    if (!key.startsWith(prefix)) continue;
    for (const e of cache[key]) {
      if (!e.to) continue;
      const at = seen.get(e.to);
      if (at === undefined || e.timestamp > at) seen.set(e.to, e.timestamp);
    }
  }
  return Array.from(seen, ([addr, lastAt]) => ({ address: addr, lastAt }))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit);
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
  entries[idx] = { ...entries[idx], ...patch };
  persist(key);
  notify();
}
