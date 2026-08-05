/**
 * wallets.ts — persistent (encrypted) wallet storage over AsyncStorage.
 *
 * Only ciphertext is written. The list mirrors the extension's shape so a
 * future multi-wallet UI drops in, but this milestone only ever holds one.
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

/** Wipe all wallet state (used for a full reset). */
export async function resetAllWallets(): Promise<void> {
  await removeItem(WALLETS_KEY);
  await removeItem(ONBOARDING_KEY);
}
