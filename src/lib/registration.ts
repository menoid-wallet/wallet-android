/**
 * registration.ts — which chains this wallet has bound to a private identity.
 *
 * Ported from the extension's lib/registration.ts (chrome.storage.local →
 * AsyncStorage). A wallet is "registered" on a chain once it has submitted
 * register(userCommitment) there. The CHAIN is the source of truth; this is a
 * local cache so the noid dashboard can decide what to show without a round
 * trip per chain on every open. `verifyAndRepair` in services/register is the
 * repair path when the two disagree — e.g. a wallet registered on another
 * device, where the chain says yes and this cache has never heard of it.
 *
 * Keyed by the REAL (open-mode) address, because that is what the on-chain
 * `registered` map is keyed by — msg.sender, not the noid identity.
 *
 * Mirrored in memory so the views can read synchronously; AsyncStorage is not
 * synchronous and a dashboard that has to await before it can decide whether to
 * show a Register button flashes the wrong thing first.
 */

import { getItem, setItem } from "./storage";
import { NETWORK_IDS, type NetworkId } from "./networks";

const STORAGE_KEY = "menoid_registered_chains";

/** { [addressLower]: { [network]: true } } */
type RegistrationMap = Record<string, Partial<Record<NetworkId, boolean>>>;

let cache: RegistrationMap | null = null;

async function readMap(): Promise<RegistrationMap> {
  if (cache) return cache;
  const stored = await getItem<RegistrationMap>(STORAGE_KEY);
  cache = stored && typeof stored === "object" ? stored : {};
  return cache;
}

async function writeMap(map: RegistrationMap): Promise<void> {
  cache = map;
  await setItem(STORAGE_KEY, map);
}

const keyOf = (address: string) => address.toLowerCase();

/** Every chain this wallet is locally marked registered on. */
export async function getRegisteredChains(address: string): Promise<NetworkId[]> {
  if (!address) return [];
  const map = await readMap();
  const entry = map[keyOf(address)] || {};
  return NETWORK_IDS.filter((n) => entry[n]);
}

export async function setChainRegistered(
  address: string,
  network: NetworkId,
  registered = true
): Promise<void> {
  if (!address) return;
  const map = await readMap();
  const k = keyOf(address);
  const next: RegistrationMap = { ...map, [k]: { ...(map[k] || {}) } };
  if (registered) next[k][network] = true;
  else delete next[k][network];
  await writeMap(next);
}

/** Load the cache into memory. Call once before the first synchronous read. */
export async function primeRegistrations(): Promise<void> {
  await readMap();
}
