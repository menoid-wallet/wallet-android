/**
 * WalletContext.tsx — the wallet session.
 *
 * The ENCRYPTED wallet lives on disk (lib/wallets). The DECRYPTED keys live
 * here in memory and only while unlocked, so:
 *   - closing / backgrounding-then-killing the app drops them → lock screen
 *   - unlock() decrypts with the password and holds the result for the session
 *   - lock() forgets them again
 *
 * This is the same trust model as the extension (chrome.storage.local held only
 * ciphertext; the unlocked keys were session memory).
 *
 * VIEW STATE LIVES HERE TOO — `mode` (open ↔ noid) and `treasureChain` — for the
 * same reason it did in the extension: the mode decides the colour of the sky
 * behind every screen, so it cannot belong to any one screen. `mode` is
 * persisted; the wallet should reopen in the weather you left it in. It is NOT
 * cleared on lock, because that is a preference, not a secret.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  decryptAll,
  readWalletsState,
  type WalletEntry,
} from "../lib/wallets";
import { getItem, setItem } from "../lib/storage";
import type { StoredWallet } from "../crypto/walletCrypto";
import type { NetworkId } from "../lib/networks";

const MODE_KEY = "menoid_view_mode";

export type WalletMode = "open" | "noid";

/**
 * Which chain the Treasure card features. A specific NetworkId shows that
 * chain's native balance front-and-centre and drops that chain's own token bar;
 * "all" reverts to the combined USD total across every chain.
 */
export type TreasureChain = NetworkId | "all";

interface Session {
  wallets: StoredWallet[];
  entries: WalletEntry[];
  active: number;
}

interface WalletContextValue {
  session: Session | null;
  isUnlocked: boolean;
  /** The active wallet's decrypted keys, or null while locked. */
  wallet: StoredWallet | null;
  /** The active wallet's stored entry (name, addresses), or null while locked. */
  activeEntry: WalletEntry | null;
  mode: WalletMode;
  setMode: (m: WalletMode) => void;
  treasureChain: TreasureChain;
  setTreasureChain: (c: TreasureChain) => void;
  /** Decrypt with the password. Resolves true on success, false on wrong pw. */
  unlock: (password: string) => Promise<boolean>;
  /** Forget the decrypted keys (back to the lock screen). */
  lock: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setModeState] = useState<WalletMode>("open");
  const [treasureChain, setTreasureChainState] = useState<TreasureChain>("all");

  useEffect(() => {
    getItem<WalletMode>(MODE_KEY).then((m) => {
      if (m === "open" || m === "noid") setModeState(m);
    });
  }, []);

  const setMode = useCallback((m: WalletMode) => {
    setModeState(m);
    void setItem(MODE_KEY, m);
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const state = await readWalletsState();
    if (!state) return false;
    try {
      const wallets = await decryptAll(state, password);
      setSession({
        wallets,
        entries: state.list,
        active: Math.min(state.active, wallets.length - 1),
      });
      return true;
    } catch {
      return false; // wrong password (AES-GCM auth tag failed)
    }
  }, []);

  const lock = useCallback(() => setSession(null), []);

  const wallet = session ? (session.wallets[session.active] ?? null) : null;
  const activeEntry = session ? (session.entries[session.active] ?? null) : null;

  const value = useMemo<WalletContextValue>(
    () => ({
      session,
      isUnlocked: session != null,
      wallet,
      activeEntry,
      mode,
      setMode,
      treasureChain,
      setTreasureChain: setTreasureChainState,
      unlock,
      lock,
    }),
    [session, wallet, activeEntry, mode, setMode, treasureChain, unlock, lock]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
