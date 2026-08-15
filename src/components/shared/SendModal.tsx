/**
 * SendModal.tsx — open-mode send, in three stages.
 *
 *   1. TO      three-quarter sheet: one recipient field, the people you have
 *              paid on this chain below it, a Next button pinned above the
 *              keyboard
 *   2. AMOUNT  full screen: the mark on the left, the figure on the right, and
 *              OUR OWN keypad — never the system one, which would cover the
 *              screen with a grey slab in the middle of the wallet's own sky
 *   3. SENDING the mark watches the voyage cloud; then the receipt
 *
 * The stages are two panes laid over each other and slid sideways, and the
 * sheet grows from three-quarters to full screen underneath them — one native
 * translate each (see LiquidSheet's `snap`), so moving between stages costs
 * nothing and cannot stutter.
 *
 * WHY THE PANES ARE ABSOLUTELY POSITIONED AT THE TOP OF THE SURFACE: a snapped
 * sheet is always a full-window-tall surface pushed down by the part that
 * should stay off screen, so "the visible region" is always its top edge
 * downward. Each pane just declares how much of that it wants.
 *
 * Ported from the extension's shared/SendModal.tsx — same phases, same faces
 * (the mark dozes until you have a recipient, wakes, watches, then winks) and
 * the same per-chain validation, which has to be per-chain: an EVM checksum
 * test would reject every Solana address the user could legitimately paste.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  InteractionManager,
  Easing,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { ethers, isAddress } from "ethers";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWallet } from "../../context/WalletContext";
import { track } from "../../services/analytics";
import { explorerTxUrl, sendNative } from "../../lib/rpc";
import { NETWORKS, type NetworkId } from "../../lib/networks";
import {
  hydrateAddressBookFor,
  hydrateNoidAddressBookFor,
  recentRecipientsFor,
  saveOpenTx,
  updateOpenTx,
} from "../../lib/txStore";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";
import type { ChainMeta } from "../../lib/chains";
import AnimatedLogo from "../brand/AnimatedLogo";
import CloudChip from "../brand/CloudChip";
import CloudVoyage from "./CloudVoyage";
import LiquidSheet from "./LiquidSheet";
import { COLORS, FONT } from "../../theme/tokens";
import { rgba } from "../../theme/useThemeTokens";

const INK = COLORS.violetDeep;
const INK_RGB = "78,47,142";
const BAD = "#B2382A";

const SNAP_TO = 0.75;
const SNAP_AMOUNT = 1;
/* The loading and receipt stages stay SNAPPED — at a fraction, not unsnapped.
   Dropping `snap` there made the sheet switch from a full-window surface to a
   content-sized one, which is a different layout mode and therefore a hard cut:
   the full-screen amount stage vanished and the small loading card was simply
   there. Keeping it snapped means the same surface springs from 1 down to this,
   and the change of size IS the transition. */
const SNAP_SUBMIT = 0.56;

type Phase = "to" | "amount" | "submitting" | "success";

function isValidAddressForChain(address: string, network: NetworkId): boolean {
  const clean = address.trim();
  if (!clean) return false;
  if (network === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
  if (network === "sui" || network === "aptos") return /^0x[0-9a-fA-F]{1,64}$/.test(clean);
  return isAddress(clean);
}

/** Smallest-unit decimals per chain — what the log entry's hex value is in. */
function decimalsFor(network: NetworkId): number {
  if (network === "solana" || network === "sui") return 9;
  if (network === "aptos") return 8;
  return 18;
}

function trunc(s: string, a = 8, b = 6) {
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s;
}

function relTime(ts: number): string {
  const sec = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export default memo(function SendModal({
  open,
  onClose,
  chain,
  network,
  fromAddress,
  privateKey,
  balance,
  usdPrice = 0,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  chain: ChainMeta;
  network: NetworkId;
  fromAddress: string;
  privateKey: string;
  balance: string;
  usdPrice?: number;
  onSent?: (hash: string) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  /* A snapped sheet holds its position when the keyboard opens, so the pane
     shortens instead: its head stays where it was and its foot rises to sit on
     the keys. Lifting the sheet itself dragged the header off the top of the
     screen and left the surface's unused lower half filling the gap. */
  const kb = useKeyboardHeight();
  const symbol = NETWORKS[network].nativeCurrency;

  const [phase, setPhase] = useState<Phase>("to");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [inFiat, setInFiat] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [txHash, setTxHash] = useState("");

  // Reset only AFTER the sheet has finished sliding away — resetting on close
  // rewrites the form under the user while they can still see it.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setPhase("to");
      setTo("");
      setAmount("");
      setInFiat(false);
      setSubmitErr("");
      setTxHash("");
    }, 340);
    return () => clearTimeout(t);
  }, [open]);

  /* The address book spans every ACCOUNT but not every CHAIN.
     
     It used to span everything, which put Solana and Aptos addresses in the
     recents list of a Monad send — addresses that cannot even be pasted into
     that field, let alone paid. `recentRecipientsFor` scopes to the chain, with
     the three EVMs sharing one book because one address genuinely works on all
     of them. Accounts still all count: someone you paid from account 1 is
     someone you know from account 2.

     The logs have to be pulled off disk before they can be scanned, so opening
     the sheet loads them and the list is recomputed when they land. */
  const { entries, wallet } = useWallet();
  const [bookTick, setBookTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const senders = entries.flatMap((e) =>
      [e.openAddress, e.solanaAddress, e.suiAddress, e.aptosAddress].filter(Boolean) as string[]
    );
    /* Only the UNLOCKED wallet carries noid keys — the entry list is just
       labels and public addresses — so the private log can only be scanned for
       the wallet you are currently in. */
    const noidKeys = [
      wallet?.noidAccount?.publicKey,
      wallet?.solanaNoidAccount?.publicKey,
      wallet?.suiNoidAccount?.publicKey,
      wallet?.aptosNoidAccount?.publicKey,
    ].filter(Boolean) as string[];
    /* AFTER THE SHEET HAS FINISHED OPENING. Recents are a convenience; making
       the open animation wait on storage and RPC is how a modal comes to feel
       like it takes two seconds to appear. */
    const task = InteractionManager.runAfterInteractions(() => {
      void Promise.all([
        hydrateAddressBookFor(network, senders),
        hydrateNoidAddressBookFor(network, noidKeys),
      ]).then(() => alive && setBookTick((n) => n + 1));
    });
    return () => {
      alive = false;
      task.cancel();
    };
  }, [open, entries, wallet, network]);

  const recents = useMemo(
    () => (open ? recentRecipientsFor(network) : []),
    [open, network, bookTick]
  );

  const addrOk = useMemo(() => isValidAddressForChain(to, network), [to, network]);

  /* The figure is typed in whichever unit the chip is showing, but the send is
     always in the token — so the token amount is derived, never the other way
     round, and rounding can only ever bite the display. */
  const tokenAmount = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return inFiat ? (usdPrice > 0 ? n / usdPrice : 0) : n;
  }, [amount, inFiat, usdPrice]);

  const counterValue = useMemo(() => {
    const n = Number(amount) || 0;
    if (inFiat) return `${(usdPrice > 0 ? n / usdPrice : 0).toFixed(6).replace(/\.?0+$/, "") || "0"} ${symbol}`;
    return `$${(n * usdPrice).toFixed(2)}`;
  }, [amount, inFiat, usdPrice, symbol]);

  const overBalance = tokenAmount > Number(balance);
  const amountOk = tokenAmount > 0 && !overBalance;

  // ── Stage slide ───────────────────────────────────────────────────────────
  const step = useRef(new Animated.Value(0)).current; // 0 = to, 1 = amount
  useEffect(() => {
    Animated.timing(step, {
      toValue: phase === "to" ? 0 : 1,
      duration: 420,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [phase, step]);

  const goAmount = useCallback(() => {
    Keyboard.dismiss();
    setPhase("amount");
  }, []);

  async function handleSend() {
    if (!amountOk) return;
    const value = String(tokenAmount);
    setSubmitErr("");
    setPhase("submitting");

    /* Let the loading stage PAINT before the signing starts. `sendNative` opens
       with synchronous key work, and on a single JS thread that runs before
       React can flush the state above — so the button looked dead for a beat
       and then the screen jumped. Same fix as MaskModal.start. */
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r()))
    );

    const t0 = Date.now();
    try {
      const r = await sendNative(privateKey, to.trim(), value, network);
      /* Open mode is public anyway, but the hash and the recipient still have
         no business in our analytics — duration and outcome do. */
      track("open_send", { status: "success", network, durationMs: Date.now() - t0 });
      setTxHash(r.hash);
      setPhase("success");
      onSent?.(r.hash);

      const parsed = ethers.parseUnits(tokenAmount.toFixed(decimalsFor(network)), decimalsFor(network));
      // Saved immediately so the log shows it right away, then patched with the
      // gas once the receipt lands (EVM only — the others report none).
      saveOpenTx(fromAddress, network, {
        type: "open",
        txHash: r.hash,
        gasUsed: null,
        to: to.trim(),
        value: "0x" + parsed.toString(16),
        functionName: "Transfer",
        timestamp: Date.now(),
      });
      r.wait()
        .then((receipt) => {
          if (receipt?.gasUsed)
            updateOpenTx(fromAddress, network, r.hash, { gasUsed: receipt.gasUsed });
        })
        .catch(() => {});
    } catch (e: any) {
      console.error("[SendModal] send failed:", e);
      setSubmitErr(e?.shortMessage ?? e?.message ?? "Transaction failed. Try again.");
      setPhase("amount");
    }
  }

  /* The two closing stages are content-sized. Pinning them to a fraction of the
     screen left a tall empty apron under the mark — they are short by nature and
     should be allowed to say so. */
  const snap = phase === "to" ? SNAP_TO : phase === "amount" ? SNAP_AMOUNT : SNAP_SUBMIT;

  const busy = phase === "submitting";
  const showPanes = phase === "to" || phase === "amount";

  return (
    <LiquidSheet
      open={open}
      onClose={onClose}
      tone="cream"
      disableDrag={busy}
      snap={snap}
      scroll={false}
      /* The amount stage is full screen, so the sheet's own close would sit in
         the status bar. That stage draws its own, in the header row. */
      hideClose={phase === "amount"}>
      {showPanes ? (
        <View style={styles.stageBay}>
          {/* ── Stage 1 · TO ── */}
          <Animated.View
            pointerEvents={phase === "to" ? "auto" : "none"}
            style={[
              styles.pane,
              { height: Math.max(260, winH * SNAP_TO - kb) },
              {
                opacity: step.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: "clamp" }),
                transform: [
                  { translateX: step.interpolate({ inputRange: [0, 1], outputRange: [0, -winW * 0.3] }) },
                ],
              },
            ]}>
            <ToStage
              bottomInset={insets.bottom}
              keyboardUp={kb > 0}
              chain={chain}
              symbol={symbol}
              to={to}
              setTo={setTo}
              addrOk={addrOk}
              recents={recents}
              onNext={goAmount}
            />
          </Animated.View>

          {/* ── Stage 2 · AMOUNT ── */}
          <Animated.View
            pointerEvents={phase === "amount" ? "auto" : "none"}
            style={[
              styles.pane,
              { height: winH },
              {
                opacity: step.interpolate({ inputRange: [0.4, 1], outputRange: [0, 1], extrapolate: "clamp" }),
                transform: [
                  { translateX: step.interpolate({ inputRange: [0, 1], outputRange: [winW * 0.3, 0] }) },
                ],
              },
            ]}>
            <AmountStage
              topInset={insets.top}
              bottomInset={insets.bottom}
              symbol={symbol}
              balance={balance}
              amount={amount}
              setAmount={setAmount}
              inFiat={inFiat}
              onToggleUnit={() => {
                setInFiat((v) => !v);
                setAmount("");
              }}
              counterValue={counterValue}
              overBalance={overBalance}
              canSend={amountOk}
              submitErr={submitErr}
              to={to}
              usdPrice={usdPrice}
              onBack={() => setPhase("to")}
              onClose={onClose}
              onSend={handleSend}
              onMax={() => {
                const n = Number(balance);
                if (!Number.isFinite(n) || n <= 0) return setAmount("0");
                const max = Math.max(0, n - 0.001);
                setAmount(inFiat ? (max * usdPrice).toFixed(2) : max.toFixed(6).replace(/\.?0+$/, ""));
              }}
            />
          </Animated.View>
        </View>
      ) : busy ? (
        <View style={[styles.pad, styles.snappedPane, { height: winH * SNAP_SUBMIT, paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.head}>
            <Text style={styles.eyebrow}>SEND TREASURE</Text>
            <Text style={styles.title}>Sending…</Text>
            <Text style={styles.sub}>Your treasure is on its way.</Text>
          </View>
          <View style={styles.centre}>
            <AnimatedLogo size={116} expression="waiting" />
            <View style={{ width: Math.min(300, winW - 80), marginTop: 18 }}>
              <CloudVoyage tone="light" label="VOYAGE IN PROGRESS" width={Math.min(300, winW - 80)} />
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.pad, styles.snappedPane, { height: winH * SNAP_SUBMIT, paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.head}>
            <Text style={styles.eyebrow}>SEND TREASURE</Text>
            <Text style={styles.title}>Delivered! ✦</Text>
            <Text style={styles.sub}>Your treasure reached the port.</Text>
          </View>

          <View style={styles.centre}>
            <AnimatedLogo size={112} expression="wink" style={{ marginBottom: 16 }} />

            <View style={styles.receipt}>
              <View style={styles.receiptTick}>
                <Svg width={14} height={14} viewBox="0 0 14 14">
                  <Path
                    d="M2 7L5.5 10.5L12 4"
                    stroke="#059669"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </Svg>
              </View>
              <View style={styles.receiptText}>
                <Text style={styles.receiptTitle}>Transaction broadcast</Text>
                <Text style={styles.receiptHash}>{txHash}</Text>
              </View>
            </View>

            <Pressable onPress={onClose} style={styles.done}>
              <Text style={styles.doneLabel}>DONE</Text>
            </Pressable>

            <Pressable onPress={() => void Linking.openURL(explorerTxUrl(txHash, network))}>
              <Text style={styles.explorer}>VIEW ON EXPLORER</Text>
            </Pressable>
          </View>
        </View>
      )}
    </LiquidSheet>
  );
});

/* ───────────────────────── Stage 1 · to ───────────────────────── */
function ToStage({
  bottomInset,
  keyboardUp,
  chain,
  symbol,
  to,
  setTo,
  addrOk,
  recents,
  onNext,
}: {
  bottomInset: number;
  keyboardUp: boolean;
  chain: ChainMeta;
  symbol: string;
  to: string;
  setTo: (v: string) => void;
  addrOk: boolean;
  recents: { address: string; lastAt: number }[];
  onNext: () => void;
}) {
  const bad = to.trim().length > 0 && !addrOk;

  return (
    <View style={styles.paneInner}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>SEND {symbol}</Text>
        <Text style={styles.title}>Who is it for?</Text>
      </View>

      <View style={styles.toFieldBay}>
        <TextInput
          value={to}
          onChangeText={setTo}
          placeholder={chain.id === "solana" ? "Base58 address…" : "0x…"}
          placeholderTextColor={rgba(INK_RGB, 0.3)}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          multiline
          style={[
            styles.toField,
            {
              borderColor: bad
                ? "rgba(178,56,42,0.45)"
                : addrOk
                  ? "rgba(31,122,85,0.45)"
                  : rgba(INK_RGB, 0.12),
            },
          ]}
        />
        {bad && <Text style={styles.err}>Not a valid {chain.name} address.</Text>}
      </View>

      <Text style={styles.recentLabel}>RECENT</Text>
      <View style={styles.recentList}>
        {recents.length === 0 ? (
          <Text style={styles.recentEmpty}>No one yet — this is your first voyage here.</Text>
        ) : (
          recents.map((r) => (
            <Pressable key={r.address} onPress={() => setTo(r.address)}>
              {({ pressed }) => (
                <View style={[styles.recentRow, pressed && styles.recentRowPressed]}>
                  <View style={styles.recentCrest}>
                    <chain.Icon size={16} color={INK} />
                  </View>
                  <View style={styles.recentText}>
                    <Text style={styles.recentAddr}>{trunc(r.address)}</Text>
                    <Text style={styles.recentWhen}>{relTime(r.lastAt)}</Text>
                  </View>
                  <Svg width={8} height={8} viewBox="0 0 10 10">
                    <Path
                      d="M3.5 2L6.5 5L3.5 8"
                      stroke={rgba(INK_RGB, 0.4)}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </Svg>
                </View>
              )}
            </Pressable>
          ))
        )}
      </View>

      {/* The footer is pinned to the bottom of the PANE, and the sheet itself
          rides up with the keyboard — so Next always sits on top of it. */}
      {/* Clear of the keyboard when it is up, clear of the gesture bar when it
          is not — and in both cases not jammed against the edge. */}
      {/* 30 left the cloud's lower lobes sitting ON the keys — a CloudChip
          overflows its content box by about half its lobe, and the pane ends
          exactly at the keyboard. */}
      <View style={[styles.paneFooter, { paddingBottom: keyboardUp ? 84 : bottomInset + 34 }]}>
        <CloudChip
          tone="violet"
          onPress={onNext}
          disabled={!addrOk}
          fullWidth
          lobeBase={26}
          contentStyle={styles.cloudBtn}>
          <Text style={styles.cloudBtnLabel}>NEXT</Text>
        </CloudChip>
      </View>
    </View>
  );
}

/* ───────────────────────── Stage 2 · amount ───────────────────────── */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

function AmountStage({
  topInset,
  bottomInset,
  symbol,
  balance,
  amount,
  setAmount,
  inFiat,
  onToggleUnit,
  counterValue,
  overBalance,
  canSend,
  submitErr,
  to,
  usdPrice,
  onBack,
  onClose,
  onSend,
  onMax,
}: {
  topInset: number;
  bottomInset: number;
  symbol: string;
  balance: string;
  amount: string;
  setAmount: (v: string) => void;
  inFiat: boolean;
  onToggleUnit: () => void;
  counterValue: string;
  overBalance: boolean;
  canSend: boolean;
  submitErr: string;
  to: string;
  usdPrice: number;
  onBack: () => void;
  onClose: () => void;
  onSend: () => void;
  onMax: () => void;
}) {
  /* The mark is sized to the figure block beside it, measured rather than
     guessed — the block's height changes with the font metrics and with whether
     the unit chip is showing a long conversion, and a fixed number drifts. */
  const [blockH, setBlockH] = useState(0);

  const press = useCallback(
    (k: string) => {
      if (k === "⌫") return setAmount(amount.slice(0, -1));
      if (k === ".") {
        if (amount.includes(".")) return;
        return setAmount(amount.length === 0 ? "0." : amount + ".");
      }
      if (amount === "0" && k !== ".") return setAmount(k);
      setAmount(amount + k);
    },
    [amount, setAmount]
  );

  return (
    <View style={styles.paneInner}>
      <View style={[styles.amountHead, { paddingTop: topInset + 6 }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Svg width={16} height={16} viewBox="0 0 10 10">
            <Path
              d="M6.5 1.5L3 5L6.5 8.5"
              stroke={INK}
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        </Pressable>
        <Text style={styles.amountTo} numberOfLines={1}>
          To {trunc(to, 6, 4)}
        </Text>
        {/* The sheet's own close would land in the status bar on a full-screen
            stage, so this stage carries it — where MAX used to be. MAX has
            moved down to the figure it actually acts on. */}
        <Pressable onPress={onClose} hitSlop={12}>
          <View style={styles.amountClose}>
            <Svg width={12} height={12} viewBox="0 0 12 12">
              <Path
                d="M2 2L10 10M10 2L2 10"
                stroke={rgba(INK_RGB, 0.7)}
                strokeWidth={1.5}
                strokeLinecap="round"
                fill="none"
              />
            </Svg>
          </View>
        </Pressable>
      </View>

      {/* The mark on the left, the figure on the right. */}
      <View style={styles.figureMiddle}>
      <View style={styles.figureRow}>
        <AnimatedLogo size={Math.max(76, blockH)} blink />
        <View
          style={styles.figureBlock}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h > 0 && h !== blockH) setBlockH(h);
          }}>
          <View style={styles.figureLine}>
            <Text style={styles.figure} numberOfLines={1} adjustsFontSizeToFit>
              {inFiat ? "$" : ""}
              {amount || "0"}
            </Text>
            {!inFiat && <Text style={styles.figureUnit}>{symbol}</Text>}
          </View>

          <View style={styles.figureControls}>
            <Pressable onPress={onToggleUnit} hitSlop={8}>
              <View style={styles.unitChip}>
                <Text style={styles.unitChipText}>{counterValue}</Text>
                <Svg width={12} height={12} viewBox="0 0 12 12">
                  <Path
                    d="M3.5 7.5V2M3.5 2L2 3.5M3.5 2L5 3.5M8.5 4.5V10M8.5 10L7 8.5M8.5 10L10 8.5"
                    stroke={rgba(INK_RGB, 0.6)}
                    strokeWidth={1.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </Svg>
              </View>
            </Pressable>
            <Pressable onPress={onMax} hitSlop={10}>
              <View style={styles.maxChip}>
                <Text style={styles.maxChipText}>MAX</Text>
              </View>
            </Pressable>
          </View>

          {/* Quoted in whatever unit you are typing in. Showing the balance in
              the token while the figure above it is in dollars is two different
              questions answered at once. */}
          <Text style={[styles.available, overBalance && { color: BAD }]}>
            {overBalance ? "Only " : ""}
            {inFiat
              ? `$${(Number(balance) * usdPrice).toFixed(2)}`
              : `${Number(balance).toFixed(5)} ${symbol}`}{" "}
            available
          </Text>
        </View>
      </View>

      {!!submitErr && (
        <View style={styles.errBox}>
          <Text style={styles.errBoxText}>{submitErr}</Text>
        </View>
      )}
      </View>

      <View style={[styles.keypadBay, { paddingBottom: bottomInset + 34 }]}>
        <View style={styles.sendBay}>
          <CloudChip
            tone="violet"
            onPress={onSend}
            disabled={!canSend}
            fullWidth
            lobeBase={26}
            contentStyle={styles.cloudBtn}>
            <Text style={styles.cloudBtnLabel}>{submitErr ? "TRY AGAIN" : "SEND"}</Text>
          </CloudChip>
        </View>

        {/* Our own keypad. The system one would put a grey slab over the sky and
            offers no way to lay the figure out beside the mark. */}
        <View style={styles.keypad}>
          {KEYS.map((k) => (
            <Pressable key={k} onPress={() => press(k)} style={styles.keyBay}>
              {({ pressed }) => (
                <View style={[styles.key, pressed && styles.keyPressed]}>
                  {k === "⌫" ? (
                    <Svg width={22} height={18} viewBox="0 0 22 18">
                      <Path
                        d="M7 1.5h12.5v15H7L1.5 9z"
                        stroke={INK}
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                        fill="none"
                      />
                      <Path
                        d="M10.5 6.5l5 5M15.5 6.5l-5 5"
                        stroke={INK}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                      />
                    </Svg>
                  ) : (
                    <Text style={styles.keyLabel}>{k}</Text>
                  )}
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stageBay: { flex: 1 },
  pane: { position: "absolute", top: 0, left: 0, right: 0 },
  paneInner: { flex: 1, paddingHorizontal: 22 },
  paneFooter: { paddingTop: 10 },

  pad: { paddingHorizontal: 24, paddingTop: 2 },
  snappedPane: { justifyContent: "center" },
  head: { alignItems: "center", paddingBottom: 10 },
  eyebrow: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 4, color: rgba(INK_RGB, 0.7), marginBottom: 4 },
  title: { fontFamily: FONT.roundBold, fontSize: 20, color: "#3B2570", letterSpacing: -0.3 },
  sub: { fontFamily: FONT.body, fontSize: 11, color: rgba(INK_RGB, 0.6), marginTop: 4 },
  centre: { alignItems: "center", paddingTop: 8, paddingBottom: 10, paddingHorizontal: 24 },

  /* ── to ── */
  toFieldBay: { marginTop: 2 },
  toField: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 62,
    fontFamily: FONT.mono,
    fontSize: 13,
    lineHeight: 19,
    color: INK,
    backgroundColor: "rgba(255,255,255,0.5)",
    textAlignVertical: "top",
  },
  err: { fontFamily: FONT.body, fontSize: 10, color: BAD, marginTop: 6, marginLeft: 4 },

  recentLabel: {
    fontFamily: FONT.roundSemi,
    fontSize: 9,
    letterSpacing: 3.2,
    color: rgba(INK_RGB, 0.45),
    marginTop: 22,
    marginBottom: 10,
  },
  recentList: { flex: 1, gap: 8 },
  recentEmpty: { fontFamily: FONT.body, fontSize: 12, fontStyle: "italic", color: rgba(INK_RGB, 0.42) },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.62)",
  },
  recentRowPressed: { transform: [{ scale: 0.985 }], backgroundColor: "rgba(255,255,255,0.62)" },
  recentCrest: {
    height: 32,
    width: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: rgba(INK_RGB, 0.08),
    borderWidth: 1,
    borderColor: rgba(INK_RGB, 0.12),
  },
  recentText: { flex: 1, minWidth: 0 },
  recentAddr: { fontFamily: FONT.mono, fontSize: 12, color: rgba(INK_RGB, 0.85) },
  recentWhen: { fontFamily: FONT.body, fontSize: 9.5, color: rgba(INK_RGB, 0.45), marginTop: 2 },

  /* ── amount ── */
  amountHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 6 },
  figureMiddle: { flex: 1, justifyContent: "center" },
  amountTo: { flex: 1, fontFamily: FONT.mono, fontSize: 11, color: rgba(INK_RGB, 0.55) },
  amountClose: {
    height: 34,
    width: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: rgba(INK_RGB, 0.06),
    borderWidth: 1,
    borderColor: rgba(INK_RGB, 0.12),
  },
  figureControls: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  maxChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: rgba(INK_RGB, 0.07),
  },
  maxChipText: { fontFamily: FONT.roundBold, fontSize: 11, letterSpacing: 1.4, color: rgba(INK_RGB, 0.7) },

  figureRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  figureBlock: { flex: 1, minWidth: 0 },
  figureLine: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  figure: { fontFamily: FONT.roundBold, fontSize: 44, color: "#3B2570", letterSpacing: -1.2, flexShrink: 1 },
  figureUnit: { fontFamily: FONT.roundBold, fontSize: 20, color: rgba(INK_RGB, 0.35), marginBottom: 6 },
  unitChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: rgba(INK_RGB, 0.07),
  },
  unitChipText: { fontFamily: FONT.mono, fontSize: 12, color: rgba(INK_RGB, 0.7) },
  available: { fontFamily: FONT.body, fontSize: 11.5, color: rgba(INK_RGB, 0.5), marginTop: 10 },

  errBox: {
    marginTop: 14,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(178,56,42,0.1)",
    borderWidth: 1,
    borderColor: "rgba(178,56,42,0.2)",
  },
  errBoxText: { fontFamily: FONT.body, fontSize: 11, color: BAD },

  keypadBay: {},
  sendBay: { marginBottom: 16 },
  keypad: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  keyBay: { width: "31.4%", flexGrow: 1 },
  key: {
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
  },
  keyPressed: { backgroundColor: "rgba(255,255,255,0.85)", transform: [{ scale: 0.96 }] },
  keyLabel: { fontFamily: FONT.roundBold, fontSize: 24, color: "#3B2570" },

  cloudBtn: { paddingVertical: 13 },
  cloudBtnLabel: { fontFamily: FONT.roundBold, fontSize: 12, letterSpacing: 2.4, color: "#F4EEFF" },

  /* ── receipt ── */
  receipt: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(5,150,105,0.1)",
    borderWidth: 1,
    borderColor: "rgba(5,150,105,0.25)",
    marginBottom: 18,
  },
  receiptTick: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: "rgba(5,150,105,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptText: { flex: 1, minWidth: 0 },
  receiptTitle: { fontFamily: FONT.bodySemi, fontSize: 12, color: "#047857" },
  receiptHash: { fontFamily: FONT.mono, fontSize: 10, color: rgba(INK_RGB, 0.6), marginTop: 4 },

  done: {
    width: "100%",
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: INK,
    alignItems: "center",
  },
  doneLabel: { fontFamily: FONT.roundSemi, fontSize: 11, letterSpacing: 3, color: "#F4EEFF" },
  explorer: {
    fontFamily: FONT.body,
    fontSize: 10,
    letterSpacing: 2.2,
    color: rgba(INK_RGB, 0.5),
    marginTop: 14,
  },
});
