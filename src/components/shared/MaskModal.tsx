/**
 * MaskModal.tsx — hiding funds in the pool, in the noid weather.
 *
 * Copy is deliberately PLAIN. This screen spends real money and then waits
 * twenty seconds on a cryptographic operation; "veil drawn" and "the noid cave"
 * were decoration over the one moment a person most needs to be told exactly
 * what is going on.
 *
 * The extension's MaskModal, rebuilt around the shape open mode's SendModal
 * already established here, because they are the same gesture: name a figure,
 * confirm, watch it go. So the amount stage IS the send modal's amount stage —
 * mark on the left, figure on the right, our own keypad, the same MAX and unit
 * controls — repainted in noid's palette, with the rain running behind it.
 *
 * TWO THINGS IT ADDS OVER SEND:
 *   1. the relayer fee, stated on its own line under the figure. Masking pays a
 *      relayer to carry the note, and the amount that lands in the pool is what
 *      you typed MINUS that fee — which is the one number a person actually
 *      wants to check before committing.
 *   2. a longer wait, because a zero-knowledge proof is built on the device.
 *      That is why the loading stage says what it is doing rather than just
 *      spinning; see FLAVOUR.
 *
 * THE SHEET MORPHS BETWEEN STAGES INSTEAD OF SWAPPING. Every stage is SNAPPED —
 * full screen for the figure, a little over half for the wait — so the one
 * surface springs between the two sizes. Dropping `snap` for the small stages
 * (which is what SendModal used to do) switches the sheet to content-sizing,
 * a different layout mode, and a different layout mode cannot animate: the
 * full-screen stage vanished and the small one was simply there.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { explorerTxUrl } from "../../lib/rpc";
import Svg, { Path } from "react-native-svg";
import type { ChainMeta } from "../../lib/chains";
import type { NetworkId } from "../../lib/networks";
import AnimatedLogo from "../brand/AnimatedLogo";
import CloudChip from "../brand/CloudChip";
import CloudVoyage from "./CloudVoyage";
import LiquidSheet from "./LiquidSheet";
import { track } from "../../services/analytics";
import { RainFar, RainNear } from "../brand/Rain";
import { FONT } from "../../theme/tokens";

const INK = "#F4EEFF";
const INK_RGB = "244,238,255";
const ACCENT = "#C9B0FF";
const BAD = "#FF8E86";

/* Full screen to name the figure, then only as much as each later stage
   actually needs. 0.56 for both left a third of the sheet empty above the mark
   and a third below it — a snapped sheet is a fixed slice of the window, so any
   slack shows as blank surface rather than shrinking away. */
/** "3d ago" — the recents list only needs the shape of the gap, not a date. */
function relTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const SNAP_TO = 0.75;
const SNAP_FORM = 1;
const SNAP_BUSY = 0.44;
const SNAP_DONE = 0.36;

/** What the relayer charges to carry the note. The extension's table. */
export function minFeeFor(network: NetworkId): string {
  return network === "monad" ? "0.001" : "0.0001";
}

type Phase = "form" | "proving" | "sending" | "success" | "error";

/* The wait is long enough that a static label reads as a hang, so the line
   changes every few seconds. Plain description of what is happening — the
   nautical voice the extension used says nothing about a proof being built. */
const FLAVOUR: Record<string, string[]> = {
  proving: [
    "Building the zero-knowledge proof…",
    "This runs on your phone, not a server…",
    "Almost there…",
  ],
  sending: ["Sending to the pool…", "Waiting for confirmation…"],
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

/**
 * The words. Hide and Unhide are the SAME SCREEN — name a figure, watch a proof
 * get built, see a receipt — so they are one component with two vocabularies
 * rather than two files that drift apart.
 */
export interface FlowCopy {
  eyebrow: string;
  title: (symbol: string) => string;
  cta: string;
  feeLabel: string;
  totalLabel: string;
  busyEyebrow: string;
  provingTitle: string;
  sendingTitle: string;
  doneTitle: string;
  availableNote: (amount: string, symbol: string) => string;
  /**
   * Does the service want the GROSS (amount + fee), or the NET?
   *
   * Deposit takes a gross transfer and subtracts the relayer's cut inside, so
   * hide sends amount+fee. Withdraw and transfer are the opposite:
   * `planWithdraw`/`planTransfer` read the figure as what the RECEIVER gets and
   * pick extra notes to cover the fee on top. Sending them the gross made a
   * "2, fee 0.2" send pay out 2.2 — the fee went to the recipient.
   */
  grossToService: boolean;
}

export const HIDE_COPY: FlowCopy = {
  eyebrow: "PRIVATE BALANCE",
  title: (s) => `Hide ${s}`,
  cta: "HIDE",
  feeLabel: "Relayer fee",
  totalLabel: "Total from your balance",
  busyEyebrow: "HIDING",
  provingTitle: "Creating proof…",
  sendingTitle: "Sending…",
  doneTitle: "Amount hidden.",
  availableNote: (a, s) => `${a} ${s} available`,
  // deposit nets the fee out itself
  grossToService: true,
};

/** Private send: pool → someone else's pool. Nothing becomes public. */
export const NOIDSEND_COPY: FlowCopy = {
  eyebrow: "PRIVATE SEND",
  title: (s) => `Send ${s}`,
  cta: "SEND",
  feeLabel: "Relayer fee",
  totalLabel: "Total from private",
  busyEyebrow: "PRIVATE SEND",
  provingTitle: "Proving the notes…",
  sendingTitle: "Sending privately…",
  doneTitle: "Sent.",
  availableNote: (a, s) => `Private balance ${a} ${s}`,
  // planTransfer adds the per-batch fee on top of this
  grossToService: false,
};

export const UNHIDE_COPY: FlowCopy = {
  eyebrow: "BACK TO PUBLIC",
  title: (s) => `Unhide ${s}`,
  cta: "UNHIDE",
  feeLabel: "Relayer fee",
  totalLabel: "Total from private balance",
  busyEyebrow: "UNHIDING",
  provingTitle: "Creating proof…",
  sendingTitle: "Sending…",
  doneTitle: "Amount returned.",
  availableNote: (a, s) => `${a} ${s} hidden`,
  // planWithdraw adds the fee on top of this
  grossToService: false,
};

export interface MaskRunArgs {
  /** decimal native amount, e.g. "1.5" */
  amount: string;
  /** only for private send */
  recipient?: string;
  /** decimal relayer fee */
  fee: string;
  network: NetworkId;
  onProving?: () => void;
  onSending?: (hash: string) => void;
}

export default memo(function MaskModal({
  open,
  onClose,
  chain,
  network,
  balance,
  usdPrice = 0,
  runMask,
  onDone,
  fee: feeOverride,
  copy = HIDE_COPY,
  needsRecipient = false,
  onResolveRecipient,
  feeUnregistered,
  recents = [],
}: {
  open: boolean;
  onClose: () => void;
  chain: ChainMeta;
  network: NetworkId;
  /** the balance this flow spends FROM — public for hide, private for unhide */
  balance: string;
  usdPrice?: number;
  /** Does the real work. Kept out of here so the screen stays a screen. */
  runMask: (a: MaskRunArgs) => Promise<{ hash: string }>;
  onDone?: () => void;
  /** decimal fee; defaults to the mask table */
  fee?: string;
  copy?: FlowCopy;
  /** private send asks who it is for BEFORE the figure; hide/unhide do not */
  needsRecipient?: boolean;
  /** resolves a typed address to a private identity — false means unregistered */
  onResolveRecipient?: (address: string) => Promise<boolean>;
  /** charged instead of `fee` when the recipient turns out to be unregistered,
      because that send is a withdraw and withdraws cost more */
  feeUnregistered?: string;
  /** everyone this wallet has paid on this chain, newest first */
  recents?: { address: string; lastAt: number }[];
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>("form");
  const [amount, setAmount] = useState("");
  const [inFiat, setInFiat] = useState(false);
  const [err, setErr] = useState("");
  const [hash, setHash] = useState("");
  const [to, setTo] = useState("");
  const [toState, setToState] = useState<"idle" | "checking" | "ok" | "unregistered" | "error">("idle");
  const [stage, setStage] = useState<"to" | "amount">(needsRecipient ? "to" : "amount");
  /* The mark is sized to the block beside it, measured rather than guessed —
     exactly as the send modal does it, so the two screens are the same screen. */
  const [blockH, setBlockH] = useState(0);

  /* The address stage's footer follows the keyboard, exactly as the send
     modal's does — otherwise NEXT hides behind the keys. */
  const [kbUp, setKbUp] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener("keyboardDidShow", () => setKbUp(true));
    const b = Keyboard.addListener("keyboardDidHide", () => setKbUp(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  /* False for the first frame after opening — see the rain below. */
  const [dressed, setDressed] = useState(false);
  useEffect(() => {
    if (!open) {
      setDressed(false);
      return;
    }
    const h = requestAnimationFrame(() => setDressed(true));
    return () => cancelAnimationFrame(h);
  }, [open]);

  /* An unregistered recipient turns this into a withdraw to their real wallet,
     and that costs the withdraw fee — so the figure on screen has to follow the
     lookup, not the flow it started as. */
  const fee =
    toState === "unregistered" && feeUnregistered
      ? feeUnregistered
      : feeOverride ?? minFeeFor(network);
  const symbol = chain.symbol;

  // Reset only AFTER it has slid away — rewriting the form under someone who
  // can still see it is the same mistake SendModal fixed.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setPhase("form");
      setAmount("");
      setInFiat(false);
      setErr("");
      setHash("");
      setTo("");
      setToState("idle");
      setStage(needsRecipient ? "to" : "amount");
    }, 340);
    return () => clearTimeout(t);
  }, [open, needsRecipient]);

  /* Resolve while they type — pressing NEXT must never sit on a round trip.
     
     TWO THINGS THIS HAS TO GET RIGHT, both of which bit us:

     It CACHES BY ADDRESS. `onResolveRecipient` is a closure from the parent and
     changes identity on every render, so a bare dependency on it re-ran this
     effect constantly; each re-run reset the state to "checking", and since the
     quoted fee follows the state, the fee flickered back to the registered
     price while the user was on the amount stage. Typing an amount re-renders
     per keystroke, so the lookup was cancelled and restarted forever and never
     settled at all. Keyed by address, a repeat is a no-op.

     It STOPS AT THE ADDRESS STAGE. Once they press NEXT the outcome is locked;
     re-deciding registered-ness underneath a figure they already typed is how
     the fee changes after the fact. */
  const resolveRef = useRef(onResolveRecipient);
  resolveRef.current = onResolveRecipient;
  const resolved = useRef<Map<string, "ok" | "unregistered">>(new Map());

  useEffect(() => {
    const addr = to.trim();
    if (!needsRecipient || stage !== "to") return;
    if (addr.length < 8) {
      setToState("idle");
      return;
    }
    const cached = resolved.current.get(addr);
    if (cached) {
      setToState(cached);
      return;
    }

    let alive = true;
    setToState("checking");
    const t = setTimeout(() => {
      const run = resolveRef.current;
      if (!run) return;
      run(addr)
        .then((ok) => {
          const outcome = ok ? "ok" : "unregistered";
          resolved.current.set(addr, outcome);
          if (alive) setToState(outcome);
        })
        .catch(() => alive && setToState("error"));
    }, 420);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [to, stage, needsRecipient]);

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

  /* WHAT YOU TYPE IS WHAT GETS HIDDEN. The relayer fee is charged ON TOP, not
     carved out of it — the extension's service takes a gross deposit and
     subtracts internally, so the gross is computed here and the figure on
     screen stays the thing the person actually asked for. */
  const feeNum = Number(fee) || 0;
  const totalCost = tokenAmount > 0 ? tokenAmount + feeNum : 0;
  const overBalance = totalCost > Number(balance);
  const canMask = tokenAmount > 0 && !overBalance;

  const press = useCallback(
    (k: string) => {
      setErr("");
      if (k === "⌫") return setAmount((a) => a.slice(0, -1));
      if (k === ".") return setAmount((a) => (a.includes(".") ? a : a.length === 0 ? "0." : a + "."));
      setAmount((a) => (a === "0" ? k : a + k));
    },
    []
  );

  const start = useCallback(async () => {
    if (!canMask) return;
    const t0 = Date.now();
    setErr("");
    setPhase("proving");

    /* YIELD BEFORE THE HEAVY WORK. `runMask` starts with a long run of
       synchronous crypto — poseidon hashes, ECIES envelopes — and JS is single
       threaded, so calling it in this tick means React never gets to paint the
       loading stage it was just told about. The button sat there looking dead
       and then the screen jumped. Two frames is enough for the state to flush
       and for the sheet to start its resize. */
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r()))
    );

    try {
      const res = await runMask({
        /* See FlowCopy.grossToService — hide sends the gross because deposit
           subtracts the fee internally; withdraw and transfer send the NET,
           because their planners add the fee on top and anything extra lands
           in the recipient's hands. */
        amount: (copy.grossToService ? totalCost : tokenAmount)
          .toFixed(8)
          .replace(/\.?0+$/, ""),
        fee,
        network,
        recipient: to.trim() || undefined,
        onProving: () => setPhase("proving"),
        onSending: (h) => {
          setHash(h);
          setPhase("sending");
        },
      });
      setHash(res.hash);
      setPhase("success");
      onDone?.();
    } catch (e: any) {
      /* The error KIND, never the message — service messages interpolate
         amounts and addresses. */
      const msg = String(e?.message ?? "");
      track(copy.cta.toLowerCase() + "_failed", {
        status: "failure",
        network,
        durationMs: Date.now() - t0,
        errorKind: /not enough/i.test(msg)
          ? "insufficient"
          : /merkle/i.test(msg)
            ? "no_merkle_proof"
            : /relayer/i.test(msg)
              ? "relayer"
              : "unknown",
      });
      setErr(e?.message ?? "Masking failed.");
      setPhase("error");
    }
  }, [canMask, runMask, totalCost, tokenAmount, copy, fee, network, to, onDone]);

  const busy = phase === "proving" || phase === "sending";
  const isForm = phase === "form" || phase === "error";
  const snap = isForm ? (stage === "to" ? SNAP_TO : SNAP_FORM) : busy ? SNAP_BUSY : SNAP_DONE;

  return (
    <LiquidSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      tone="ink"
      snap={snap}
      disableDrag={busy}
      scroll={false}
      hideClose={isForm && stage !== "to"}>
      {/* The weather comes INTO the sheet. Noid mode is the rain, and a modal
          that dropped it would read as a different application. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {/* THE RAIN ARRIVES ONE FRAME LATE. The drops are the costly half of
            this tree, and mounting them in the same frame as the sheet delayed
            the slide itself — the modal appeared to hesitate before opening.
            Deferring them lets the sheet open at once and the rain come in
            under it, which nobody reads as missing. */}
        {dressed && <RainFar height={winH} />}
        <RainNear height={winH} />
      </View>

      {isForm && stage === "to" ? (
        /* The address stage is a THREE-QUARTER sheet, not full screen — same as
           the open-mode send. A full-screen pane for one short field reads as a
           different app, and it buries the recents list below the fold. */
        <View style={[styles.pane, { height: winH * SNAP_TO }]}>
          <View style={styles.headTight}>
            <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
            <Text style={styles.title}>Who is it for?</Text>
          </View>

          <TextInput
            value={to}
            onChangeText={(v) => {
              setTo(v);
              setErr("");
            }}
            placeholder="0x…"
            placeholderTextColor={`rgba(${INK_RGB},0.32)`}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            multiline
            style={[
              styles.toField,
              toState === "unregistered" && { borderColor: "rgba(245,196,81,0.5)" },
              toState === "ok" && { borderColor: "rgba(150,255,205,0.4)" },
            ]}
          />

          {/* Resolution runs AS YOU TYPE, so NEXT never has to wait on the
              network. The three outcomes are genuinely different, and an
              unregistered address is not an error — it is a different send. */}
          {toState === "checking" && <Text style={styles.toHint}>Looking them up…</Text>}
          {toState === "ok" && <Text style={styles.toHintOk}>Private identity found.</Text>}
          {toState === "unregistered" && (
            <Text style={styles.toHintWarn}>
              Their direct {chain.name} wallet will receive the funds, because
              they haven't registered for private mode.
            </Text>
          )}
          {toState === "error" && <Text style={styles.toHintWarn}>Couldn't check that address.</Text>}

          <Text style={styles.recentLabel}>RECENT</Text>
          <ScrollView
            style={styles.recentList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {recents.length === 0 ? (
              <Text style={styles.recentEmpty}>No one yet.</Text>
            ) : (
              recents.map((r) => (
                <Pressable key={r.address} onPress={() => setTo(r.address)}>
                  {({ pressed }) => (
                    <View style={[styles.recentRow, pressed && styles.recentRowPressed]}>
                      <View style={styles.recentCrest}>
                        <chain.Icon size={15} color={INK} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.recentAddr}>
                          {r.address.slice(0, 10)}…{r.address.slice(-6)}
                        </Text>
                        <Text style={styles.recentWhen}>{relTime(r.lastAt)}</Text>
                      </View>
                      <Svg width={8} height={8} viewBox="0 0 10 10">
                        <Path
                          d="M3.5 2L6.5 5L3.5 8"
                          stroke={`rgba(${INK_RGB},0.4)`}
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
          </ScrollView>

          {/* Clear of the keyboard when it is up, clear of the gesture bar when
              it is not — the same footer rule the send modal uses, and 34
              rather than 18 because a CloudChip overflows its content box by
              about half a lobe. */}
          <View
            style={[
              styles.toFooter,
              { paddingBottom: kbUp ? 84 : insets.bottom + 34 },
            ]}>
            <CloudChip
              tone="light"
              fullWidth
              lobeBase={26}
              /* NEXT waits for the lookup to LAND, not just for text to exist.
                 The caller caches the resolved identity against this address;
                 letting them past on a half-typed one would carry a stale
                 recipient into the send. */
              disabled={toState !== "ok" && toState !== "unregistered"}
              contentStyle={styles.cta}
              onPress={() => setStage("amount")}>
              <Text style={styles.ctaText}>NEXT</Text>
            </CloudChip>
          </View>
        </View>
      ) : isForm ? (
        <View style={[styles.pane, { height: winH * SNAP_FORM }]}>
          <View style={[styles.head, { paddingTop: insets.top + 6 }]}>
            <Pressable onPress={needsRecipient ? () => setStage("to") : onClose} hitSlop={12}>
              <Svg width={16} height={16} viewBox="0 0 10 10">
                <Path
                  d="M6.5 8.5L3 5L6.5 1.5"
                  stroke={INK}
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </Pressable>
            <View style={styles.headText}>
              <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
              <Text style={styles.title}>{copy.title(symbol)}</Text>
            </View>
            <View style={{ width: 16 }} />
          </View>

          {/* mark on the left, figure on the right — send mode's arrangement */}
          <View style={styles.figureMiddle}>
            <View style={styles.figureRow}>
              <AnimatedLogo
                size={Math.max(76, blockH)}
                expression={tokenAmount > 0 ? "awake" : "sleeping"}
              />
              <View
                style={styles.figureBlock}
                onLayout={(e) => {
                  const h = e.nativeEvent.layout.height;
                  if (h > 0 && h !== blockH) setBlockH(h);
                }}>
                <View style={styles.figureLine}>
                  <Text style={styles.figure} numberOfLines={1} adjustsFontSizeToFit>
                    {inFiat ? `$${amount || "0"}` : amount || "0"}
                  </Text>
                  {!inFiat && <Text style={styles.figureUnit}>{symbol}</Text>}
                </View>

                <Text style={styles.available} numberOfLines={1}>
                  {/* Trimmed — a raw wei-derived string runs to 18 places and
                      wrapped onto a second line under the figure. */}
                  {copy.availableNote(
                    (Number(balance) || 0).toFixed(4).replace(/\.?0+$/, "") || "0",
                    symbol
                  )}
                </Text>

                <View style={styles.figureControls}>
                  <Pressable onPress={() => { setInFiat((v) => !v); setAmount(""); }} hitSlop={8}>
                    <View style={styles.unitChip}>
                      <Text style={styles.unitChipText}>{counterValue}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const n = Number(balance);
                      if (!Number.isFinite(n) || n <= 0) return setAmount("0");
                      const max = Math.max(0, n - feeNum - 0.0005);
                      setAmount(inFiat ? (max * usdPrice).toFixed(2) : max.toFixed(6).replace(/\.?0+$/, ""));
                    }}
                    hitSlop={8}>
                    <View style={styles.maxChip}>
                      <Text style={styles.maxChipText}>MAX</Text>
                    </View>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* ── the fee, and what actually lands ── */}
            <View style={styles.feeBay}>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>{copy.feeLabel}</Text>
                <Text style={styles.feeValue}>
                  {fee} {symbol}
                </Text>
              </View>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>{copy.totalLabel}</Text>
                <Text style={[styles.feeValue, styles.feeStrong]}>
                  {totalCost > 0 ? totalCost.toFixed(6).replace(/\.?0+$/, "") : "0"} {symbol}
                </Text>
              </View>
            </View>

            {!!(overBalance || err) && (
              <Text style={styles.err}>
                {overBalance
                  ? `Only ${(Number(balance) || 0).toFixed(4).replace(/\.?0+$/, "") || "0"} ${symbol} available.`
                  : err}
              </Text>
            )}
          </View>

          <View style={[styles.keypadBay, { paddingBottom: insets.bottom + 34 }]}>
            {/* Above the keys, like the send modal: the action you are working
                toward should not be the thing your thumb has to reach past. */}
            <CloudChip
              tone="light"
              onPress={start}
              disabled={!canMask}
              fullWidth
              lobeBase={26}
              contentStyle={styles.cta}>
              <Text style={styles.ctaText}>
                {phase === "error" ? "TRY AGAIN" : copy.cta}
              </Text>
            </CloudChip>

            <View style={styles.keypad}>
              {KEYS.map((k) => (
                <Pressable key={k} onPress={() => press(k)} style={styles.keyBay}>
                  {({ pressed }) => (
                    <View style={[styles.key, pressed && styles.keyDown]}>
                      <Text style={styles.keyText}>{k}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : busy ? (
        <View style={[styles.pane, styles.centred, { height: winH * SNAP_BUSY }]}>
          <Text style={styles.eyebrow}>{copy.busyEyebrow}</Text>
          <Text style={styles.title}>{phase === "proving" ? copy.provingTitle : copy.sendingTitle}</Text>
          <AnimatedLogo size={110} expression="waiting" style={{ marginTop: 14 }} />
          <View style={{ width: Math.min(300, winW - 80), marginTop: 18 }}>
            <CloudVoyage tone="dark" rain label={phase === "proving" ? "CREATING PROOF" : "SENDING"} width={Math.min(300, winW - 80)} />
          </View>
          <Flavour phase={phase} />
        </View>
      ) : (
        <View
          style={[
            styles.pane,
            styles.centred,
            /* Real air under the last control — the cloud's lower lobes were
               landing on the very edge of the sheet. */
            { height: winH * SNAP_DONE, paddingBottom: insets.bottom + 26 },
          ]}>
          <Text style={styles.eyebrow}>COMPLETE</Text>
          <Text style={styles.title}>{copy.doneTitle}</Text>
          <AnimatedLogo size={112} expression="wink" style={{ marginBottom: 16 }} />
          {!!hash && (
            <Text style={styles.hash} numberOfLines={1}>
              {hash.slice(0, 10)}…{hash.slice(-8)}
            </Text>
          )}
          <View style={{ width: "100%", marginTop: 20 }}>
            <CloudChip tone="light" onPress={onClose} fullWidth lobeBase={26} contentStyle={styles.cta}>
              <Text style={styles.ctaText}>DONE</Text>
            </CloudChip>
          </View>

          {!!hash && (
            <Pressable onPress={() => void Linking.openURL(explorerTxUrl(hash, network))} hitSlop={8}>
              <Text style={styles.explorer}>VIEW ON EXPLORER ↗</Text>
            </Pressable>
          )}
        </View>
      )}
    </LiquidSheet>
  );
});

/** One line at a time, swapped on a timer — the extension's FlavorText. */
const Flavour = memo(function Flavour({ phase }: { phase: string }) {
  const lines = FLAVOUR[phase] ?? [];
  const [i, setI] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    setI(0);
    if (lines.length < 2) return;
    const id = setInterval(() => {
      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 320, delay: 60, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      setTimeout(() => setI((n) => (n + 1) % lines.length), 280);
    }, 3200);
    return () => clearInterval(id);
  }, [phase, lines.length, fade]);

  if (!lines.length) return null;
  return <Animated.Text style={[styles.flavour, { opacity: fade }]}>{lines[i]}</Animated.Text>;
});

const styles = StyleSheet.create({
  pane: { paddingHorizontal: 24 },
  centred: { alignItems: "center", justifyContent: "center" },

  head: { flexDirection: "row", alignItems: "center", paddingBottom: 6 },
  headText: { flex: 1, alignItems: "center" },
  eyebrow: {
    fontFamily: FONT.body,
    fontSize: 9,
    letterSpacing: 4,
    color: `rgba(${INK_RGB},0.65)`,
    marginBottom: 4,
    textAlign: "center",
  },
  title: { fontFamily: FONT.roundBold, fontSize: 20, color: INK, letterSpacing: -0.3, textAlign: "center" },

  figureMiddle: { flex: 1, justifyContent: "center" },
  figureRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  figureBlock: { flex: 1, minWidth: 0 },
  figureLine: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  figure: { fontFamily: FONT.roundBold, fontSize: 44, color: INK, letterSpacing: -1.2, flexShrink: 1 },
  figureUnit: { fontFamily: FONT.roundBold, fontSize: 20, color: `rgba(${INK_RGB},0.4)`, marginBottom: 6 },
  figureControls: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  unitChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  unitChipText: { fontFamily: FONT.mono, fontSize: 12, color: `rgba(${INK_RGB},0.8)` },
  maxChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(201,176,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(201,176,255,0.45)",
  },
  maxChipText: { fontFamily: FONT.roundBold, fontSize: 10, letterSpacing: 1.4, color: ACCENT },

  feeBay: {
    marginTop: 26,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    gap: 8,
  },
  feeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feeLabel: { fontFamily: FONT.body, fontSize: 12, color: `rgba(${INK_RGB},0.6)` },
  feeValue: { fontFamily: FONT.mono, fontSize: 12, color: `rgba(${INK_RGB},0.85)` },
  feeStrong: { fontFamily: FONT.roundBold, fontSize: 13, color: ACCENT },

  headTight: { paddingTop: 18, paddingBottom: 14 },
  toHint: { marginTop: 10, fontFamily: FONT.body, fontSize: 12, color: `rgba(${INK_RGB},0.55)` },
  toHintOk: { marginTop: 10, fontFamily: FONT.body, fontSize: 12, color: "rgba(150,255,205,0.85)" },
  toHintWarn: {
    marginTop: 10,
    fontFamily: FONT.body,
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(245,206,120,0.92)",
  },
  recentLabel: {
    marginTop: 18,
    marginBottom: 8,
    fontFamily: FONT.body,
    fontSize: 10,
    letterSpacing: 1.6,
    color: `rgba(${INK_RGB},0.42)`,
  },
  recentList: { flex: 1 },
  recentEmpty: { fontFamily: FONT.body, fontSize: 12, color: `rgba(${INK_RGB},0.4)` },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  recentRowPressed: { backgroundColor: `rgba(${INK_RGB},0.08)` },
  recentCrest: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `rgba(${INK_RGB},0.1)`,
  },
  recentAddr: { fontFamily: FONT.mono, fontSize: 13, color: INK },
  recentWhen: { marginTop: 2, fontFamily: FONT.body, fontSize: 11, color: `rgba(${INK_RGB},0.45)` },
  toFooter: { paddingTop: 12 },
  toField: {
    /* ONE line, not three — matched to the send modal's field (62pt). A short
       0x address does not need a paragraph box, and the taller field pushed the
       recents list and NEXT off the comfortable part of the sheet. */
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: FONT.mono,
    fontSize: 14,
    color: INK,
    textAlignVertical: "top",
  },
  toNote: {
    marginTop: 12,
    fontFamily: FONT.body,
    fontSize: 12,
    lineHeight: 18,
    color: `rgba(${INK_RGB},0.6)`,
  },
  err: { marginTop: 14, fontFamily: FONT.roundSemi, fontSize: 12.5, color: BAD, textAlign: "center" },

  keypadBay: { gap: 14 },
  keypad: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  keyBay: { width: "31.5%", flexGrow: 1 },
  /* Frosted, not solid. A keypad of twelve bright slabs took the whole screen
     over and left the figure — the thing you are actually reading — as the
     quietest object on it. Light enough to read as "lit", sheer enough to stay
     behind the number. */
  key: {
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,238,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  keyDown: { backgroundColor: "rgba(244,238,255,0.3)", borderColor: "rgba(255,255,255,0.45)" },
  keyText: { fontFamily: FONT.roundBold, fontSize: 20, color: INK },

  cta: { paddingVertical: 15, justifyContent: "center" },
  ctaText: { fontFamily: FONT.roundBold, fontSize: 12.5, letterSpacing: 1.8, color: "#3B2570" },
  available: { fontFamily: FONT.mono, fontSize: 10.5, color: `rgba(${INK_RGB},0.55)`, marginTop: 6 },

  flavour: {
    marginTop: 14,
    fontFamily: FONT.body,
    fontStyle: "italic",
    fontSize: 11.5,
    color: `rgba(${INK_RGB},0.7)`,
    textAlign: "center",
  },
  explorer: {
    marginTop: 14,
    fontFamily: FONT.roundSemi,
    fontSize: 10,
    letterSpacing: 1.8,
    color: "rgba(201,176,255,0.75)",
  },
  hash: { marginTop: 10, fontFamily: FONT.mono, fontSize: 11, color: `rgba(${INK_RGB},0.6)` },
});
