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
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  decryptAll,
  readWalletsState,
  type WalletEntry,
} from "../lib/wallets";
import type { StoredWallet } from "../crypto/walletCrypto";

interface Session {
  wallets: StoredWallet[];
  entries: WalletEntry[];
  active: number;
}

interface WalletContextValue {
  session: Session | null;
  isUnlocked: boolean;
  /** Decrypt with the password. Resolves true on success, false on wrong pw. */
  unlock: (password: string) => Promise<boolean>;
  /** Forget the decrypted keys (back to the lock screen). */
  lock: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

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

  const value = useMemo<WalletContextValue>(
    () => ({ session, isUnlocked: session != null, unlock, lock }),
    [session, unlock, lock]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
