/**
 * CoinDetailView.tsx — the per-token page.
 *
 * Ported from the extension's shared/CoinDetailView.tsx. The page background
 * follows the active mode while the graph card renders as its INVERSE — a dark
 * grid-lined card on the light page — so it reads as the home treasury card
 * having grown into the chart. That inversion is also what makes the shared
 * element morph work: the two cards are the same object, so watching one become
 * the other is legible rather than a swap.
 *
 * Two FLIP morphs run on mount (see lib/flip.ts):
 *   - the tapped token bar's crest flies up into the header chip
 *   - the home treasure card expands into the graph card's shell
 * and on the way out the graph card's rect is handed back so the dashboard can
 * grow its treasure card out of it — the exact reverse.
 *
 * Live price + history come from CoinGecko (a mainnet proxy per testnet); the
 * `balance` is the real on-chain testnet amount, valued at the live price.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import type { ChainMeta } from "../../lib/chains";
import type { ChartRange, PriceInfo } from "../../services/prices";
import { useTokenChart } from "../../lib/usePrices";
import {
  flipTransform,
  measureRect,
  FLIP_CARD_EASING,
  FLIP_CARD_MS,
  FLIP_ICON_EASING,
  FLIP_ICON_MS,
  type Rect,
} from "../../lib/flip";
import LiveAreaChart from "./LiveAreaChart";
import { FONT } from "../../theme/tokens";
import { rgba, themeTokens } from "../../theme/useThemeTokens";

const SPRING = Easing.bezier(0.34, 1.56, 0.64, 1);
const EASE = Easing.bezier(0.65, 0, 0.35, 1);

const CARD_RADIUS = 28;
const CHART_H = 128;

export interface CoinAction {
  key: string;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  /** muted = looks disabled (e.g. "Buy") but still fires onPress for a toast */
  tone?: "primary" | "muted";
}

export interface MorphSource {
  card: Rect | null;
  icon: Rect | null;
}

const RANGES: { key: ChartRange; label: string }[] = [
  { key: "1", label: "1D" },
  { key: "7", label: "1W" },
  { key: "30", label: "1M" },
  { key: "365", label: "1Y" },
];

function fmtCurrency(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "$0.00";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: v >= 1 ? 2 : 6,
  });
}

function fmtBalance(b: string): string {
  const n = Number(b);
  if (!Number.isFinite(n) || n === 0) return "0.00";
  if (n < 0.01) return n.toFixed(4);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** Fade + rise, staggered — the extension's coinBlockIn, natively. */
function BlockIn({
  delay,
  children,
  style,
}: {
  delay: number;
  children: React.ReactNode;
  style?: any;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.timing(v, {
      toValue: 1,
      duration: 560,
      delay,
      easing: SPRING,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [v, delay]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

export default function CoinDetailView({
  chain,
  pageTheme,
  balance,
  price,
  priceLoading,
  balanceLabel = "Your Balance",
  morph,
  onBack,
  actions,
  shipsLog,
  children,
}: {
  chain: ChainMeta;
  /** page background mode; the graph card is the inverse of this */
  pageTheme: "light" | "dark";
  balance: string;
  price?: PriceInfo;
  priceLoading?: boolean;
  balanceLabel?: string;
  morph?: MorphSource | null;
  /** receives the graph card's current rect so the list can reverse-morph */
  onBack: (graphRect: Rect | null) => void;
  actions: CoinAction[];
  shipsLog: React.ReactNode;
  children?: React.ReactNode;
}) {
  const isLightPage = pageTheme === "light";
  const { width: winW } = useWindowDimensions();
  const [range, setRange] = useState<ChartRange>("7");
  const { points, loading: chartLoading } = useTokenChart(chain.id, range);
  const rangeIndex = RANGES.findIndex((r) => r.key === range);

  const shellRef = useRef<View>(null);
  const iconRef = useRef<View>(null);

  // ── Theme ────────────────────────────────────────────────────────────────
  // Derived from `pageTheme`, not the mode: "light" is reached from open's clear
  // sky and "dark" from noid's storm, so the two coin pages are the same page
  // under different weather.
  const t = themeTokens(!isLightPage);
  const cardIsDark = isLightPage;
  const cardTokens = themeTokens(cardIsDark);

  const cardColors = cardIsDark
    ? (["#6247A8", "#3D2673", "#2B1A55"] as const)
    : (["#FBF7FF", "#EADFFC", "#D6C4F5"] as const);
  const cardInk = cardIsDark ? "244,238,255" : "59,37,112";
  const lineColor = cardIsDark ? "#E4D6FF" : "#4E2F8E";
  const pillOn = cardIsDark ? "#F4EEFF" : "#4E2F8E";
  const pillOnInk = cardIsDark ? "#3B2570" : "#FBF7FF";

  const chipColors = isLightPage
    ? (["#6247A8", "#3B2570"] as const)
    : (["#FBF7FF", "#D6C4F5"] as const);
  const chipInk = isLightPage ? "#F4EEFF" : "#3B2570";

  const usdValue = (Number(balance) || 0) * (price?.usd ?? 0);
  const change = price?.change24h ?? 0;
  const up = change >= 0;
  // The pill sits ON the card, and the card is the page's inverse — so it takes
  // the CARD's up/down. Read from the page's tokens it came out as open mode's
  // deep green painted on a deep violet card.
  const changeColor = up ? cardTokens.up : cardTokens.down;

  // ── Shared-element morph ─────────────────────────────────────────────────
  const flip = useRef(new Animated.Value(1)).current;
  const iconFlip = useRef(new Animated.Value(1)).current;
  const [cardT, setCardT] = useState<ReturnType<typeof flipTransform>>(null);
  const [iconT, setIconT] = useState<ReturnType<typeof flipTransform>>(null);

  /* THE MORPHING ELEMENTS START INVISIBLE. Measuring "where it now is" needs a
     layout pass, so the transform cannot exist on the first frame — and for that
     one frame the graph card would paint at its FINAL size and place, before
     snapping back to the treasure card to fly in. That read as two cards: one
     already arrived, one still travelling. They are revealed in the same commit
     that applies the transform, so the first thing you ever see is the card
     sitting exactly on top of the one you tapped. */
  const [cardHidden, setCardHidden] = useState(!!morph?.card);
  const [iconHidden, setIconHidden] = useState(!!morph?.icon);

  /* KICKED BY onLayout, NOT BY A TIMER. "Where it now is" only means anything
     once the page has been laid out, and onLayout is the exact moment that
     becomes true — a requestAnimationFrame is a guess that is sometimes early
     (nothing to measure) and always at least one frame late. Those frames are
     the whole gap between the tap and the card starting to move. */
  const morphKicked = useRef(false);
  const morphCancelled = useRef(false);
  useEffect(() => () => { morphCancelled.current = true; }, []);

  const startMorph = useCallback(() => {
    if (morphKicked.current) return;
    if (!morph?.card && !morph?.icon) return;
    morphKicked.current = true;

    void (async () => {
      const [cardTo, iconTo] = await Promise.all([
        measureRect(shellRef.current),
        measureRect(iconRef.current),
      ]);
      if (morphCancelled.current) return;

      const cardTr = morph.card && cardTo ? flipTransform(flip, morph.card, cardTo) : null;
      const iconTr = morph.icon && iconTo ? flipTransform(iconFlip, morph.icon, iconTo) : null;

      if (cardTr) flip.setValue(0);
      if (iconTr) iconFlip.setValue(0);

      // One commit: the transforms land and the elements become visible
      // together, so neither is ever painted at rest before it has flown.
      setCardT(cardTr);
      setIconT(iconTr);
      setCardHidden(false);
      setIconHidden(false);

      if (cardTr) {
        Animated.timing(flip, {
          toValue: 1,
          duration: FLIP_CARD_MS,
          easing: FLIP_CARD_EASING,
          useNativeDriver: true,
        }).start(() => !morphCancelled.current && setCardT(null));
      }
      if (iconTr) {
        Animated.timing(iconFlip, {
          toValue: 1,
          duration: FLIP_ICON_MS,
          easing: FLIP_ICON_EASING,
          useNativeDriver: true,
        }).start(() => !morphCancelled.current && setIconT(null));
      }
    })();
    // One-shot: the morph is a handshake with the screen we came from.
  }, [morph, flip, iconFlip]);

  const handleBack = useCallback(() => {
    void (async () => {
      onBack(await measureRect(shellRef.current));
    })();
  }, [onBack]);

  // ── Header ───────────────────────────────────────────────────────────────
  const headIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(headIn, { toValue: 1, duration: 460, easing: EASE, useNativeDriver: true }).start();
  }, [headIn]);

  const chartW = winW - 40 - 40; // page padding (20×2) + card padding (20×2)

  return (
    <View style={styles.page}>
      {/* ── Header ── */}
      <Animated.View
        style={[
          styles.header,
          {
            opacity: headIn,
            transform: [{ translateY: headIn.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
          },
        ]}>
        <Pressable onPress={handleBack} hitSlop={10}>
          {({ pressed }) => (
            <View
              style={[
                styles.back,
                {
                  backgroundColor: rgba(t.inkRgb, 0.06),
                  borderColor: rgba(t.inkRgb, 0.1),
                  transform: [{ scale: pressed ? 0.93 : 1 }],
                },
              ]}>
              <Svg width={14} height={14} viewBox="0 0 10 10">
                <Path
                  d="M6.5 8.5L3 5L6.5 1.5"
                  stroke={t.ink}
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </View>
          )}
        </Pressable>

        <View style={styles.headRight}>
          <View style={styles.headText}>
            <Text style={[styles.headName, { color: t.ink }]}>{chain.name}</Text>
            <Text style={[styles.headSub, { color: rgba(t.inkRgb, 0.4) }]}>
              {chain.subtitle.toUpperCase()} · {chain.symbol}
            </Text>
          </View>
          <Animated.View
            ref={iconRef}
            collapsable={false}
            style={[
              styles.headChip,
              iconHidden && styles.preMorph,
              iconT
                ? {
                    transform: [
                      { translateX: iconT.translateX },
                      { translateY: iconT.translateY },
                      { scaleX: iconT.scaleX },
                      { scaleY: iconT.scaleY },
                    ],
                  }
                : null,
            ]}>
            <LinearGradient
              colors={chipColors as unknown as readonly [string, string, ...string[]]}
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.85, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
            />
            <View style={styles.glyph}>
              <chain.Icon size={22} color={chipInk} />
            </View>
          </Animated.View>
        </View>
      </Animated.View>

      {/* ── Graph card (morph target) ── */}
      <View style={styles.cardBay}>
        <Animated.View
          ref={shellRef}
          collapsable={false}
          onLayout={startMorph}
          style={[
            styles.shell,
            cardHidden && styles.preMorph,
            cardT
              ? {
                  transform: [
                    { translateX: cardT.translateX },
                    { translateY: cardT.translateY },
                    { scaleX: cardT.scaleX },
                    { scaleY: cardT.scaleY },
                  ],
                }
              : null,
          ]}>
          <LinearGradient
            colors={cardColors as unknown as readonly [string, string, ...string[]]}
            locations={[0, 0.58, 1]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* content — never scaled, so the type stays crisp through the morph */}
        <BlockIn delay={120} style={styles.cardContent}>
          <Text style={[styles.eyebrow, { color: rgba(cardInk, 0.4) }]}>PRICE</Text>

          {priceLoading && !price ? (
            <View style={[styles.priceGhost, { backgroundColor: rgba(cardInk, 0.08) }]} />
          ) : (
            <View style={styles.priceRow}>
              <Text style={[styles.price, { color: rgba(cardInk, 0.96) }]}>
                {fmtCurrency(price?.usd ?? 0)}
              </Text>
              <View style={[styles.changePill, { backgroundColor: `${changeColor}22` }]}>
                <Svg width={8} height={8} viewBox="0 0 8 8" style={up ? undefined : styles.flip}>
                  <Path d="M4 1.5L7 5.5H1L4 1.5Z" fill={changeColor} />
                </Svg>
                <Text style={[styles.changeText, { color: changeColor }]}>
                  {Math.abs(change).toFixed(2)}%
                </Text>
              </View>
            </View>
          )}

          <View style={styles.chartBay}>
            <LiveAreaChart
              points={points ?? []}
              width={chartW}
              height={CHART_H}
              lineColor={lineColor}
              areaColor={chain.color}
              loading={chartLoading}
              emptyColor={rgba(cardInk, 0.4)}
            />
          </View>

          {/* range toggle — centred, with a sliding indicator */}
          <View style={styles.rangeBay}>
            <View style={[styles.rangeTrack, { backgroundColor: rgba(cardInk, 0.08), borderColor: rgba(cardInk, 0.08) }]}>
              <RangeKnob index={rangeIndex} color={pillOn} />
              {RANGES.map((r) => (
                <Pressable key={r.key} onPress={() => setRange(r.key)} style={styles.rangeBtn}>
                  <Text
                    style={[
                      styles.rangeLabel,
                      { color: r.key === range ? pillOnInk : rgba(cardInk, 0.55) },
                    ]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </BlockIn>
      </View>

      {/* ── Balance card ── */}
      <BlockIn
        delay={200}
        style={[
          styles.balanceCard,
          {
            backgroundColor: isLightPage ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.10)",
            borderColor: isLightPage ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.18)",
          },
        ]}>
        <View style={styles.balanceRow}>
          <View>
            <Text style={[styles.balanceLabel, { color: rgba(t.inkRgb, 0.4) }]}>
              {balanceLabel.toUpperCase()}
            </Text>
            <Text style={[styles.balanceValue, { color: t.ink }]}>
              {fmtBalance(balance)}
              <Text style={[styles.balanceSymbol, { color: rgba(t.inkRgb, 0.4) }]}> {chain.symbol}</Text>
            </Text>
          </View>
          <View style={styles.balanceRight}>
            <Text style={[styles.balanceLabel, { color: rgba(t.inkRgb, 0.4) }]}>VALUE</Text>
            <Text style={[styles.balanceUsd, { color: rgba(t.inkRgb, 0.75) }]}>
              {fmtCurrency(usdValue)}
            </Text>
          </View>
        </View>
      </BlockIn>

      {/* ── Actions ── */}
      <BlockIn delay={280} style={styles.actions}>
        {actions.map((a) => (
          <ActionTile key={a.key} action={a} inkRgb={t.inkRgb} isLightPage={isLightPage} />
        ))}
      </BlockIn>

      {/* ── Ship's Log ── */}
      <BlockIn delay={360} style={styles.logBay}>
        <View style={styles.logHead}>
          <View style={[styles.logRule, { backgroundColor: rgba(t.inkRgb, 0.12) }]} />
          <Text style={[styles.logTitle, { color: rgba(t.inkRgb, 0.4) }]}>SHIP'S LOG</Text>
          <View style={[styles.logRule, { backgroundColor: rgba(t.inkRgb, 0.12) }]} />
        </View>
        {shipsLog}
      </BlockIn>

      {children}
    </View>
  );
}

/* ───────────────────────── Range knob ───────────────────────── */
const RangeKnob = memo(function RangeKnob({ index, color }: { index: number; color: string }) {
  const x = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    Animated.timing(x, {
      toValue: index,
      duration: 400,
      easing: SPRING,
      useNativeDriver: true,
    }).start();
  }, [index, x]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.rangeKnob,
        {
          backgroundColor: color,
          transform: [
            { translateX: x.interpolate({ inputRange: [0, 3], outputRange: [0, 36 * 3] }) },
          ],
        },
      ]}
    />
  );
});

/* ───────────────────────── Action tile ───────────────────────── */
const ActionTile = memo(function ActionTile({
  action,
  inkRgb,
  isLightPage,
}: {
  action: CoinAction;
  inkRgb: string;
  isLightPage: boolean;
}) {
  const muted = action.tone === "muted";
  const bg = muted
    ? isLightPage
      ? "rgba(255,255,255,0.30)"
      : "rgba(255,255,255,0.05)"
    : isLightPage
      ? "rgba(255,255,255,0.55)"
      : "rgba(255,255,255,0.12)";
  const line = muted
    ? isLightPage
      ? "rgba(255,255,255,0.45)"
      : "rgba(255,255,255,0.10)"
    : isLightPage
      ? "rgba(255,255,255,0.72)"
      : "rgba(255,255,255,0.20)";

  return (
    <Pressable onPress={action.onPress} style={styles.tileBay}>
      {({ pressed }) => (
        <View
          style={[
            styles.tile,
            {
              backgroundColor: bg,
              borderColor: line,
              opacity: muted ? 0.7 : 1,
              transform: [{ scale: pressed ? 0.93 : 1 }],
            },
          ]}>
          <View
            style={[
              styles.tileGlyph,
              {
                backgroundColor: rgba(inkRgb, muted ? 0.06 : 0.2),
                borderColor: rgba(inkRgb, muted ? 0.1 : 0.3),
              },
            ]}>
            {action.icon}
          </View>
          <Text style={[styles.tileLabel, { color: rgba(inkRgb, muted ? 0.4 : 0.82) }]}>
            {action.label}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  back: {
    height: 36,
    width: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  headText: { alignItems: "flex-end" },
  headName: { fontFamily: FONT.roundBold, fontSize: 13.5 },
  headSub: { fontFamily: FONT.mono, fontSize: 8, letterSpacing: 1.6, marginTop: 3 },
  headChip: { height: 40, width: 40, borderRadius: 16, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  glyph: { zIndex: 1 },

  /** Held back until its FLIP transform exists — see the morph effect above. */
  preMorph: { opacity: 0 },

  cardBay: { minHeight: 250, marginBottom: 16 },
  shell: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    backgroundColor: "#2B1A55",
    elevation: 12,
    shadowColor: "#1E0E46",
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  cardContent: { padding: 20 },
  eyebrow: { fontFamily: FONT.roundBold, fontSize: 8, letterSpacing: 3.2, marginBottom: 6 },
  priceGhost: { height: 28, width: 112, borderRadius: 8 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  price: { fontFamily: FONT.roundBold, fontSize: 28, letterSpacing: -0.5 },
  changePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  changeText: { fontFamily: FONT.mono, fontSize: 10, fontWeight: "600" },
  flip: { transform: [{ rotate: "180deg" }] },
  chartBay: { marginTop: 12 },
  rangeBay: { marginTop: 10, alignItems: "center" },
  rangeTrack: { flexDirection: "row", borderRadius: 999, padding: 2, borderWidth: 1 },
  rangeKnob: { position: "absolute", top: 2, bottom: 2, left: 2, width: 36, borderRadius: 999 },
  rangeBtn: { width: 36, paddingVertical: 4, alignItems: "center" },
  rangeLabel: { fontFamily: FONT.roundBold, fontSize: 9, letterSpacing: 0.6 },

  balanceCard: { padding: 16, borderRadius: 24, borderWidth: 1, marginBottom: 16 },
  balanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  balanceLabel: { fontFamily: FONT.roundSemi, fontSize: 8, letterSpacing: 2.7, marginBottom: 6 },
  balanceValue: { fontFamily: FONT.roundBold, fontSize: 24 },
  balanceSymbol: { fontFamily: FONT.body, fontSize: 13 },
  balanceRight: { alignItems: "flex-end" },
  balanceUsd: { fontFamily: FONT.mono, fontSize: 15, fontWeight: "600" },

  actions: { flexDirection: "row", gap: 10, marginBottom: 20 },
  tileBay: { flex: 1 },
  tile: { paddingTop: 11, paddingBottom: 10, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 6 },
  tileGlyph: {
    height: 32,
    width: 32,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { fontFamily: FONT.roundBold, fontSize: 10 },

  logBay: { marginTop: 4 },
  logHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  logRule: { flex: 1, height: 1 },
  logTitle: { fontFamily: FONT.roundSemi, fontSize: 8, letterSpacing: 4 },
});
