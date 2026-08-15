/**
 * refreshBus.ts — one refresh button, many things to refresh.
 *
 * The button lives in the header, but what it has to reload is spread across
 * the tree: open mode's RPC balances, PoolContext's private notes, the coin
 * page's chart. Those have no common ancestor below WalletHome and no reason to
 * know about each other, so passing a callback down would mean threading a prop
 * through every screen for one button.
 *
 * So it is a tiny bus at module scope, the same reasoning as lib/modeMotion:
 * anyone can ask for a refresh, anyone can listen. Each listener reports when it
 * finishes, and the bus stays "busy" until they all have — which is what lets
 * the numbers keep their loading state for exactly as long as something is
 * actually still loading, rather than a guessed timeout.
 */

type Listener = () => void;

/** Which half of the wallet a reload belongs to. */
export type Scope = "open" | "noid";

let nonce = 0;
/** In-flight MANUAL reloads, per scope. */
const inFlight: Record<Scope, number> = { open: 0, noid: 0 };
const tickListeners = new Set<Listener>();
const busyListeners = new Set<Listener>();

/** Bumped every time a refresh is asked for; screens watch it and refetch. */
export function getNonce(): number {
  return nonce;
}

/**
 * True while a MANUAL reload of that scope is still running.
 *
 * Scoped because the two modes reload different things: resyncing the private
 * pool must not grey out the public balances, which did not change and are not
 * being refetched. One global flag made noid's sync dim open mode's numbers.
 */
export function isBusy(scope: Scope): boolean {
  return inFlight[scope] > 0;
}

export function subscribeTick(fn: Listener): () => void {
  tickListeners.add(fn);
  return () => tickListeners.delete(fn);
}

export function subscribeBusy(fn: Listener): () => void {
  busyListeners.add(fn);
  return () => busyListeners.delete(fn);
}

/** Press the button. */
export function requestRefresh(): void {
  nonce += 1;
  for (const fn of tickListeners) fn();
}

/**
 * Wrap a reload the USER ASKED FOR, so the figures show it happening.
 *
 * Only manual refreshes go through this. Background polling, the initial load
 * and the resync after switching account all reload the same data and must stay
 * silent — numbers that pulse every few seconds on their own read as broken,
 * and dimming the balance every time someone changes account is noise, not
 * feedback. Loading state is a reply to a tap, nothing else.
 *
 * ALWAYS resolves, never rethrows: a failed refresh must still clear the state,
 * or one dead RPC leaves the numbers greyed out forever.
 */
export async function withRefresh<T>(scope: Scope, work: () => Promise<T>): Promise<T | undefined> {
  inFlight[scope] += 1;
  for (const fn of busyListeners) fn();
  try {
    return await work();
  } catch {
    return undefined;
  } finally {
    inFlight[scope] = Math.max(0, inFlight[scope] - 1);
    for (const fn of busyListeners) fn();
  }
}
