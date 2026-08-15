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
  useRef,
  useState,
} from "react";
import {
  addWallet as addWalletToDisk,
  decryptAll,
  readWalletsState,
  setActiveWallet,
  type WalletEntry,
} from "../lib/wallets";
import { getItem, setItem } from "../lib/storage";
import type { StoredWallet } from "../crypto/walletCrypto";
import type { NetworkId } from "../lib/networks";
import { track } from "../services/analytics";

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
  /**
   * Held for the life of the session so the accounts sheet can seal a NEW
   * account with the same password instead of asking for it again — what the
   * extension does too. It costs nothing in exposure: the fully decrypted keys
   * for every account are already sitting in this same object, and both die
   * together on lock().
   */
  password: string;
}

interface WalletContextValue {
  session: Session | null;
  isUnlocked: boolean;
  /** The active wallet's decrypted keys, or null while locked. */
  wallet: StoredWallet | null;
  /** The active wallet's stored entry (name, addresses), or null while locked. */
  activeEntry: WalletEntry | null;
  /** Every saved account, in order. Empty while locked. */
  entries: WalletEntry[];
  /** Index of the active account within `entries`. */
  activeIndex: number;
  /** Make another saved account the active one. */
  switchWallet: (index: number) => Promise<void>;
  /** Seal and append a new account, then switch to it. Throws while locked. */
  addWallet: (opts: { name: string; fullWallet: StoredWallet }) => Promise<void>;
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

  /* switchWallet/addWallet are async and must not be rebuilt whenever the
     session changes, or every consumer re-renders on every switch. They read
     the session through a ref instead. */
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const t0 = Date.now();
    const state = await readWalletsState();
    if (!state) return false;
    try {
      const wallets = await decryptAll(state, password);
      setSession({
        wallets,
        entries: state.list,
        active: Math.min(state.active, wallets.length - 1),
        password,
      });
      /* Duration matters here: unlock runs the KDF, and if that is slow on real
         hardware the whole app feels slow before it has drawn anything. */
      track("unlock", {
        status: "success",
        durationMs: Date.now() - t0,
        props: { wallets: wallets.length },
      });
      return true;
    } catch {
      track("unlock", { status: "failure", errorKind: "wrong_password" });
      return false; // wrong password (AES-GCM auth tag failed)
    }
  }, []);

  const lock = useCallback(() => setSession(null), []);

  const switchWallet = useCallback(async (index: number) => {
    const s = sessionRef.current;
    if (!s || index < 0 || index >= s.wallets.length || index === s.active) return;
    setSession({ ...s, active: index });
    await setActiveWallet(index);
  }, []);

  /* The new account's keys are already in hand, so the live session takes them
     directly rather than re-reading and re-decrypting the whole list. */
  const addWallet = useCallback(
    async ({ name, fullWallet }: { name: string; fullWallet: StoredWallet }) => {
      const s = sessionRef.current;
      if (!s) throw new Error("Wallet is locked.");
      const { state, index } = await addWalletToDisk({ name, password: s.password, fullWallet });
      setSession({
        wallets: [...s.wallets, fullWallet],
        entries: state.list,
        active: index,
        password: s.password,
      });
    },
    []
  );

  const wallet = session ? (session.wallets[session.active] ?? null) : null;
  const activeEntry = session ? (session.entries[session.active] ?? null) : null;

  const value = useMemo<WalletContextValue>(
    () => ({
      session,
      isUnlocked: session != null,
      wallet,
      activeEntry,
      entries: session?.entries ?? [],
      activeIndex: session?.active ?? 0,
      switchWallet,
      addWallet,
      mode,
      setMode,
      treasureChain,
      setTreasureChain: setTreasureChainState,
      unlock,
      lock,
    }),
    [
      session,
      wallet,
      activeEntry,
      switchWallet,
      addWallet,
      mode,
      setMode,
      treasureChain,
      unlock,
      lock,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
