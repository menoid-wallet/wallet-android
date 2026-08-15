/**
 * analytics.ts — our own product analytics, reporting to the Menoid backend.
 *
 * WHY WE BUILT THIS RATHER THAN USING GA. Menoid ships as a sideloaded APK and
 * an unpacked extension, so no store counts installs for us, and a privacy
 * wallet reporting user behaviour to an ad company is a contradiction we would
 * rather not ship. The backend is already ours and already sees relayed
 * transactions, so it is the one place this can live without widening who knows
 * what.
 *
 * THE RULES THIS FILE ENFORCES, and they are not negotiable:
 *
 *   · No seed phrases, private keys or spending keys. Obviously.
 *   · No commitments, randomness or nullifiers — each one identifies a note.
 *   · No recipient addresses, no transaction hashes.
 *   · No exact amounts on private flows.
 *
 * Private flows report SHAPE AND TIME ONLY — "two batches of four notes,
 * 9.4 seconds" — which is everything needed to make the feature faster and
 * nothing that helps anyone work out who paid whom. `track()` strips the
 * forbidden keys itself rather than trusting every call site to remember,
 * because one careless call site is all it takes.
 *
 * NOTHING HERE MAY EVER BLOCK THE UI. Events are queued in memory, flushed on a
 * timer, and every failure is swallowed. Analytics that costs a frame is worse
 * than no analytics.
 */

import { getItem, setItem } from "../lib/storage";
import { API_BASE } from "../lib/config";
import type { NetworkId } from "../lib/networks";

const INSTALL_KEY = "menoid_install_id_v1";
const QUEUE_KEY = "menoid_analytics_queue_v1";
const OPTOUT_KEY = "menoid_analytics_optout_v1";

/** Flush cadence. Long enough to batch, short enough to survive a force-quit. */
const FLUSH_MS = 15_000;
const MAX_BATCH = 50;
/** Past this the queue is dropped oldest-first; a stuck client must not grow forever. */
const MAX_QUEUE = 500;

export interface TrackProps {
  network?: NetworkId | string;
  status?: "success" | "failure" | "cancelled";
  durationMs?: number;
  batchCount?: number;
  batchSizes?: number[];
  proofMs?: number;
  errorKind?: string;
  props?: Record<string, unknown>;
}

interface QueuedEvent extends TrackProps {
  name: string;
  occurredAt: string;
}

let installId: string | null = null;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let optedOut = false;
let appVersion = "0.0.1";

/* ── identity ──────────────────────────────────────────────────────────── */

function randomId(): string {
  const b = new Uint8Array(16);
  (globalThis.crypto as Crypto).getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * A random per-installation id, minted once and kept.
 *
 * NOT derived from anything about the device or the wallet. A hardware id would
 * survive reinstalls and tie two wallets together; anything wallet-derived
 * would link this stream to an address. Random and local is the only version of
 * this that is safe to hold.
 */
async function getInstallId(): Promise<string> {
  if (installId) return installId;
  const stored = await getItem<string>(INSTALL_KEY);
  if (stored) {
    installId = stored;
    return stored;
  }
  const fresh = randomId();
  installId = fresh;
  await setItem(INSTALL_KEY, fresh);
  return fresh;
}

/* ── the forbidden-key filter ──────────────────────────────────────────── */

const BANNED = [
  "seed", "mnemonic", "phrase", "privatekey", "privkey", "secret", "sk",
  "commitment", "randomness", "nullifier", "note",
  "address", "recipient", "to", "from", "txhash", "hash", "signature",
  "amount", "value", "balance",
];

/**
 * Drop anything whose key looks like it carries an identifier or a figure.
 *
 * Deliberately blunt and deliberately over-eager: a false positive costs a
 * dashboard column, a false negative costs a user their privacy. Call sites
 * that genuinely need a number should send it pre-bucketed under a name that
 * says so (`amountBucket`), which states the intent in the data itself.
 */
function scrub(props?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    const key = k.toLowerCase();
    if (BANNED.some((bad) => key === bad || key.endsWith(bad))) continue;
    if (typeof v === "string" && v.length > 200) continue; // blobs are never ours
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ── queue ─────────────────────────────────────────────────────────────── */

/**
 * Record an event. Fire-and-forget by contract — never awaited, never throws.
 */
export function track(name: string, p: TrackProps = {}): void {
  if (optedOut) return;
  queue.push({
    name,
    network: p.network,
    status: p.status,
    durationMs: p.durationMs,
    batchCount: p.batchCount,
    batchSizes: p.batchSizes,
    proofMs: p.proofMs,
    errorKind: p.errorKind,
    props: scrub(p.props),
    occurredAt: new Date().toISOString(),
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= MAX_BATCH) void flush();
}

/** Push whatever is queued. Anything that fails goes back for the next round. */
export async function flush(): Promise<void> {
  if (optedOut || queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);

  try {
    const id = await getInstallId();
    const res = await fetch(`${API_BASE}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId: id,
        platform: "android",
        appVersion,
        events: batch,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    // Only clear the disk copy once the server has actually taken them.
    await setItem(QUEUE_KEY, queue);
  } catch {
    /* Offline, or the backend is down. Put them back at the FRONT so order
       survives, and let the next tick try again. Analytics is never worth
       surfacing an error to the user over. */
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
    void setItem(QUEUE_KEY, queue).catch(() => {});
  }
}

/* ── lifecycle ─────────────────────────────────────────────────────────── */

/**
 * Call once at startup.
 *
 * Reports the install on EVERY launch, not just the first: the endpoint is
 * idempotent, and making the client decide "is this my first run?" loses the
 * install permanently whenever that single call happens to fail.
 */
export async function initAnalytics(opts: { appVersion?: string } = {}): Promise<void> {
  appVersion = opts.appVersion ?? appVersion;
  optedOut = (await getItem<boolean>(OPTOUT_KEY)) === true;
  if (optedOut) return;

  const stored = await getItem<QueuedEvent[]>(QUEUE_KEY);
  if (Array.isArray(stored) && stored.length) queue = stored.slice(-MAX_QUEUE);

  const id = await getInstallId();
  try {
    await fetch(`${API_BASE}/analytics/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId: id,
        platform: "android",
        appVersion,
        osVersion: String((globalThis as any).Platform?.Version ?? ""),
        locale: "",
      }),
    });
  } catch {
    /* An install we could not report is one we will report next launch. */
  }

  if (!timer) timer = setInterval(() => void flush(), FLUSH_MS);
  void flush();
}

/** Settings toggle. Opting out stops collection AND discards what is queued. */
export async function setAnalyticsOptOut(off: boolean): Promise<void> {
  optedOut = off;
  await setItem(OPTOUT_KEY, off);
  if (off) {
    queue = [];
    await setItem(QUEUE_KEY, []);
  }
}

export async function isAnalyticsOptedOut(): Promise<boolean> {
  return (await getItem<boolean>(OPTOUT_KEY)) === true;
}
