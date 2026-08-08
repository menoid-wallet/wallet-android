/**
 * wallets.ts — persistent (encrypted) wallet storage over AsyncStorage.
 *
 * Only ciphertext is written. The list mirrors the extension's shape, and now
 * actually holds more than one: `addWallet` appends and `setActiveWallet`
 * chooses. Every entry is sealed with the SAME password — that is what lets the
 * accounts sheet add one without asking for it again, and it is why unlocking
 * decrypts the whole list in one go.
 */
import {
  decryptWallet,
  encryptWallet,
  type EncryptedWallet,
  type StoredWallet,
} from "../crypto/walletCrypto";
import { getItem, removeItem, setItem } from "./storage";

const WALLETS_KEY = "menoid_wallets";
const ONBOARDING_KEY = "menoid_onboarding";

export interface WalletEntry {
  id: string;
  name: string;
  encrypted: EncryptedWallet;
  openAddress?: string;
  solanaAddress?: string;
  suiAddress?: string;
  aptosAddress?: string;
  importedNetwork?: "ethereum" | "solana" | "sui" | "aptos";
}

export interface WalletsState {
  active: number;
  list: WalletEntry[];
}

function makeId(): string {
  try {
    // @ts-ignore
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  } catch {}
  return "w_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function readWalletsState(): Promise<WalletsState | null> {
  const raw = await getItem<any>(WALLETS_KEY);
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as WalletsState) : (raw as WalletsState);
    if (parsed && Array.isArray(parsed.list)) return parsed;
  } catch {}
  return null;
}

async function writeWalletsState(state: WalletsState): Promise<void> {
  await setItem(WALLETS_KEY, JSON.stringify(state));
  await setItem(ONBOARDING_KEY, true);
}

export async function isOnboarded(): Promise<boolean> {
  const ob = await getItem<boolean>(ONBOARDING_KEY);
  const st = await readWalletsState();
  return !!ob && !!st && st.list.length > 0;
}

/** Verify a password by decrypting every stored wallet. Throws on wrong pw. */
export async function decryptAll(state: WalletsState, password: string): Promise<StoredWallet[]> {
  const out: StoredWallet[] = [];
  for (const e of state.list) out.push(await decryptWallet(e.encrypted, password));
  return out;
}

function entryFromWallet(
  id: string,
  name: string,
  encrypted: EncryptedWallet,
  w: StoredWallet
): WalletEntry {
  return {
    id,
    name: name.trim() || "Account",
    encrypted,
    openAddress: w.normalAccount?.address,
    solanaAddress: w.solanaAccount?.address,
    suiAddress: w.suiAccount?.address,
    aptosAddress: w.aptosAccount?.address,
    importedNetwork: w.importedNetwork,
  };
}

/** Encrypt + persist the first wallet. Called at the end of create/import. */
export async function createInitialState(opts: {
  name: string;
  password: string;
  fullWallet: StoredWallet;
}): Promise<WalletsState> {
  const encrypted = await encryptWallet(opts.fullWallet, opts.password);
  const entry = entryFromWallet(makeId(), opts.name, encrypted, opts.fullWallet);
  const state: WalletsState = { active: 0, list: [entry] };
  await writeWalletsState(state);
  return state;
}

/**
 * Encrypt + append a new account, and make it the active one.
 *
 * Sealed with the password the session is already holding, so nothing is asked
 * for again — the same trade the extension makes in AddWalletInline. Returns
 * the new list and the index it landed at, so the caller can fold the (already
 * decrypted) wallet into the live session without a round trip through disk.
 */
export async function addWallet(opts: {
  name: string;
  password: string;
  fullWallet: StoredWallet;
}): Promise<{ state: WalletsState; index: number }> {
  const state = (await readWalletsState()) ?? { active: 0, list: [] };
  const encrypted = await encryptWallet(opts.fullWallet, opts.password);
  state.list = [...state.list, entryFromWallet(makeId(), opts.name, encrypted, opts.fullWallet)];
  state.active = state.list.length - 1;
  await writeWalletsState(state);
  return { state, index: state.active };
}

/** Remember which account the wallet should reopen in. */
export async function setActiveWallet(index: number): Promise<void> {
  const state = await readWalletsState();
  if (!state || index < 0 || index >= state.list.length) return;
  state.active = index;
  await writeWalletsState(state);
}

/** Wipe all wallet state (used for a full reset). */
export async function resetAllWallets(): Promise<void> {
  await removeItem(WALLETS_KEY);
  await removeItem(ONBOARDING_KEY);
}
