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
 * Keyed by the sending address, capped at 50 entries, newest first.
 */

import { getItem, setItem } from "./storage";

export interface OpenTxEntry {
  type: "open";
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

function openKey(address: string) {
  return `openaccount:${address.toLowerCase()}`;
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

/** Read this address's log from disk into the cache. Safe to call repeatedly. */
export async function hydrateOpenTxns(address: string): Promise<OpenTxEntry[]> {
  const key = openKey(address);
  if (cache[key]) return cache[key];
  const stored = await getItem<OpenTxEntry[]>(key);
  cache[key] = Array.isArray(stored) ? stored : [];
  notify();
  return cache[key];
}

/** Synchronous read — whatever hydrate last put in the cache. */
export function loadOpenTxns(address: string): OpenTxEntry[] {
  return cache[openKey(address)] ?? [];
}

export interface RecentRecipient {
  address: string;
  lastAt: number;
}

/**
 * Distinct addresses this sender has paid, most recent first.
 *
 * Keyed by the SENDER, which is what makes the send sheet's "Recent" list show
 * the right people without any per-chain bookkeeping: the three EVM networks
 * share one address, so they share their history, while Solana, Sui and Aptos
 * each have their own and are separated for free.
 */
export function recentRecipients(address: string, limit = 8): RecentRecipient[] {
  const seen = new Map<string, number>();
  for (const e of loadOpenTxns(address)) {
    if (!e.to) continue;
    const key = e.to;
    if (!seen.has(key)) seen.set(key, e.timestamp);
  }
  return Array.from(seen, ([addr, lastAt]) => ({ address: addr, lastAt }))
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, limit);
}

export function saveOpenTx(address: string, tx: OpenTxEntry): void {
  const key = openKey(address);
  cache[key] = [tx, ...(cache[key] ?? [])].slice(0, MAX);
  persist(key);
  notify();
}

/** Patch an entry in place, matched on txHash — used to fill gasUsed in later. */
export function updateOpenTx(
  address: string,
  txHash: string,
  patch: Partial<OpenTxEntry>
): void {
  const key = openKey(address);
  const entries = cache[key];
  if (!entries) return;
  const idx = entries.findIndex((e) => e.txHash === txHash);
  if (idx === -1) return;
  entries[idx] = { ...entries[idx], ...patch };
  persist(key);
  notify();
}
