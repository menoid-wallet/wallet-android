/**
 * MaskModal.tsx — hiding funds in the pool, in the noid weather.
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
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import type { ChainMeta } from "../../lib/chains";
import type { NetworkId } from "../../lib/networks";
import AnimatedLogo from "../brand/AnimatedLogo";
import CloudChip from "../brand/CloudChip";
import CloudVoyage from "./CloudVoyage";
import LiquidSheet from "./LiquidSheet";
import { RainFar, RainNear } from "../brand/Rain";
import { FONT } from "../../theme/tokens";

const INK = "#F4EEFF";
const INK_RGB = "244,238,255";
const ACCENT = "#C9B0FF";
const BAD = "#FF8E86";

/** Full screen to name the figure; a little over half to wait. */
const SNAP_FORM = 1;
const SNAP_BUSY = 0.56;

/** What the relayer charges to carry the note. The extension's table. */
export function minFeeFor(network: NetworkId): string {
  return network === "monad" ? "0.001" : "0.0001";
}

type Phase = "form" | "proving" | "sending" | "success" | "error";

/* The wait is long enough that a static label reads as a hang. The extension
   rotates a line every few seconds for exactly this reason. */
const FLAVOUR: Record<string, string[]> = {
  proving: [
    "Forging the zero-knowledge seal…",
    "No trace shall remain…",
    "The cryptographic tide rises…",
  ],
  sending: ["Slipping into the pool…", "The water closes over it…"],
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

export interface MaskRunArgs {
  /** decimal native amount, e.g. "1.5" */
  amount: string;
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
}: {
  open: boolean;
  onClose: () => void;
  chain: ChainMeta;
  network: NetworkId;
  /** public (open-mode) balance — masking moves funds OUT of this */
  balance: string;
  usdPrice?: number;
  /** Does the real work. Kept out of here so the screen stays a screen. */
  runMask: (a: MaskRunArgs) => Promise<{ hash: string }>;
  onDone?: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>("form");
  const [amount, setAmount] = useState("");
  const [inFiat, setInFiat] = useState(false);
  const [err, setErr] = useState("");
  const [hash, setHash] = useState("");
  /* The mark is sized to the block beside it, measured rather than guessed —
     exactly as the send modal does it, so the two screens are the same screen. */
  const [blockH, setBlockH] = useState(0);

  const fee = minFeeFor(network);
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
    }, 340);
    return () => clearTimeout(t);
  }, [open]);

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
    setErr("");
    setPhase("proving");
    try {
      const res = await runMask({
        // gross: what leaves the wallet. The service nets the fee back out.
        amount: totalCost.toFixed(8).replace(/\.?0+$/, ""),
        fee,
        network,
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
      setErr(e?.message ?? "Masking failed.");
      setPhase("error");
    }
  }, [canMask, runMask, totalCost, fee, network, onDone]);

  const busy = phase === "proving" || phase === "sending";
  const isForm = phase === "form" || phase === "error";
  const snap = isForm ? SNAP_FORM : SNAP_BUSY;

  return (
    <LiquidSheet
      open={open}
      onClose={busy ? () => {} : onClose}
      tone="ink"
      snap={snap}
      disableDrag={busy}
      scroll={false}
      hideClose={isForm}>
      {/* The weather comes INTO the sheet. Noid mode is the rain, and a modal
          that dropped it would read as a different application. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <RainFar height={winH} />
        <RainNear height={winH} />
      </View>

      {isForm ? (
        <View style={[styles.pane, { height: winH * SNAP_FORM }]}>
          <View style={[styles.head, { paddingTop: insets.top + 6 }]}>
            <Pressable onPress={onClose} hitSlop={12}>
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
              <Text style={styles.eyebrow}>HIDE IN THE NOID CAVE</Text>
              <Text style={styles.title}>Hide {symbol}</Text>
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
                  {(Number(balance) || 0).toFixed(4).replace(/\.?0+$/, "") || "0"} {symbol} available
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
                <Text style={styles.feeLabel}>Relayer fee</Text>
                <Text style={styles.feeValue}>
                  {fee} {symbol}
                </Text>
              </View>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Total from your balance</Text>
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
                {phase === "error" ? "TRY AGAIN" : "HIDE IN THE NOID"}
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
          <Text style={styles.eyebrow}>DRAWING THE VEIL</Text>
          <Text style={styles.title}>{phase === "proving" ? "Sealing…" : "Hiding…"}</Text>
          <AnimatedLogo size={110} expression="waiting" style={{ marginTop: 14 }} />
          <View style={{ width: Math.min(300, winW - 80), marginTop: 18 }}>
            <CloudVoyage tone="dark" rain label={phase === "proving" ? "FORGING PROOF" : "ENTERING THE POOL"} width={Math.min(300, winW - 80)} />
          </View>
          <Flavour phase={phase} />
        </View>
      ) : (
        <View style={[styles.pane, styles.centred, { height: winH * SNAP_BUSY }]}>
          <Text style={styles.eyebrow}>VEIL DRAWN</Text>
          <Text style={styles.title}>Your treasure is hidden.</Text>
          <AnimatedLogo size={106} expression="wink" style={{ marginTop: 12 }} />
          {!!hash && (
            <Text style={styles.hash} numberOfLines={1}>
              {hash.slice(0, 10)}…{hash.slice(-8)}
            </Text>
          )}
          <View style={{ width: "100%", marginTop: 22 }}>
            <CloudChip tone="light" onPress={onClose} fullWidth lobeBase={26} contentStyle={styles.cta}>
              <Text style={styles.ctaText}>DONE</Text>
            </CloudChip>
          </View>
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
  hash: { marginTop: 10, fontFamily: FONT.mono, fontSize: 11, color: `rgba(${INK_RGB},0.6)` },
});
