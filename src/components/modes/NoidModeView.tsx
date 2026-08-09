/**
 * NoidModeView.tsx — the shadow waters.
 *
 * Ported from the extension's components/modes/NoidModeView.tsx: the colour
 * INVERSE of open mode. Dark page, LIGHT treasure card, dark-glass token bars.
 * Same geometry as open mode throughout, deliberately — the two cards have to
 * cross-fade into each other on a mode switch rather than read as two unrelated
 * screens — with the two ends of the palette swapped.
 *
 * The balances are the private ones from PoolContext (notes decrypted out of
 * the pool), NOT chain balances. Everything else about the page is open mode.
 *
 * REGISTRATION GATES the numbers, never the navigation:
 *   1. nothing registered at all → the register page, until you skip it; after
 *      that the dashboard, with Register on every bar
 *   2. some chains registered → the dashboard, and every unregistered chain's
 *      bar carries a Register button where its balance would be
 *   3. an unregistered chain's COIN PAGE still opens. It used to be refused at
 *      the door and swapped for the register page, which meant a tap did
 *      something you did not ask for and a coin carried over from open mode
 *      vanished. The page opens, shows what it can, and offers Register on a
 *      bar pinned near the bottom.
 *
 * Hide / Unhide are placeholders; Send and Receive are the real modals.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useWallet } from "../../context/WalletContext";
import { usePool } from "../../context/PoolContext";
import { CHAINS, CHAIN_BY_ID } from "../../lib/chains";
import { type NetworkId } from "../../lib/networks";
import { getRegisteredChains } from "../../lib/registration";
import { useTokenPrices } from "../../lib/usePrices";
import AnimatedNumber from "../shared/AnimatedNumber";
import InlineCopyButton from "../shared/InlineCopyButton";
import CopyKeysButton from "../shared/CopyKeysButton";
import TreasureCardShell, { CARD_RADIUS } from "../shared/TreasureCardShell";
import CoinDetailView, { type CoinAction } from "../shared/CoinDetailView";
import ShipsLogEntries from "../shared/ShipsLogEntries";
import UnderDevSheet from "../shared/UnderDevSheet";
import ReceiveModal from "../shared/ReceiveModal";
import RegisterView from "./RegisterView";
import type { ModeViewProps } from "./OpenModeView";
import { FONT } from "../../theme/tokens";

const INK = "#F4EEFF";
const INK_RGB = "244,238,255";
const SLIDE_MS = 380;

/** The REAL (open-mode) address for a chain — the register map is keyed by it. */
function realAddressFor(wallet: any, id: NetworkId): string | undefined {
  if (id === "solana") return wallet?.solanaAccount?.address;
  if (id === "sui") return wallet?.suiAccount?.address;
  if (id === "aptos") return wallet?.aptosAccount?.address;
  return wallet?.normalAccount?.address;
}

function formatAssetBalance(b: string): string {
  const n = Number(b);
  if (!Number.isFinite(n) || n === 0) return "0.00";
  if (n < 0.01) return n.toFixed(4);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export default function NoidModeView({ activeCoin, setActiveCoin, registerClose }: ModeViewProps) {
  const { wallet, treasureChain } = useWallet();
  const { allBalances } = usePool();
  const { prices, loading: pricesLoading } = useTokenPrices();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [sheet, setSheet] = useState<null | "mask" | "unmask" | "transfer">(null);
  const [showReceive, setShowReceive] = useState(false);

  // ── Registration ────────────────────────────────────────────────────────
  const [registered, setRegistered] = useState<Set<NetworkId>>(new Set());
  const [regLoaded, setRegLoaded] = useState(false);
  /* Forced open by the per-chain Register buttons, so the page is reachable
     even once some other chain has been registered. */
  const [forceRegister, setForceRegister] = useState(false);
  /* "Skip for now" on the register page. Without it the gate below simply
     re-evaluated `registered.size === 0` and put the register page straight
     back up, so Skip appeared to do nothing at all. */
  const [skipped, setSkipped] = useState(false);

  const loadRegistered = useCallback(async () => {
    if (!wallet) {
      setRegistered(new Set());
      setRegLoaded(true);
      return;
    }
    const found = new Set<NetworkId>();
    for (const c of CHAINS) {
      const addr = realAddressFor(wallet, c.id);
      if (!addr) continue;
      if ((await getRegisteredChains(addr)).includes(c.id)) found.add(c.id);
    }
    setRegistered(found);
    setRegLoaded(true);
  }, [wallet]);

  useEffect(() => {
    void loadRegistered();
  }, [loadRegistered]);

  const unregisteredIds = useMemo(
    () => CHAINS.map((c) => c.id).filter((id) => !registered.has(id)),
    [registered]
  );

  const addresses = useMemo(
    () => ({
      evm: wallet?.normalAccount?.address ?? "",
      solana: wallet?.solanaAccount?.address ?? "",
      sui: wallet?.suiAccount?.address ?? "",
      aptos: wallet?.aptosAccount?.address ?? "",
    }),
    [wallet]
  );

  // ── The pager (same machinery as open mode) ─────────────────────────────
  const pager = useRef<ScrollView>(null);
  /* "tap" = you opened it here, so the slide is the point and it animates.
     "carry" = it arrived because you switched MODES while a coin was open, and
     then the slide must NOT animate: the mode pager is already carrying this
     whole view across, and a second animation underneath it read as "back to
     the list, then over to noid, then into the coin page" — three moves for
     what should be one. Arriving instantly means this view is already showing
     the coin page by the time the mode transition reveals it. */
  const pendingOpen = useRef<null | "tap" | "carry">(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<NetworkId | null>(null);
  /* BOTH views follow the coin, not just the one on screen.
     Gating this on `isActive` is what produced the three-move mode switch: the
     view you were leaving snapped back to its list WHILE it slid away, and the
     one arriving then slid into its coin page after it landed. Keeping both
     pagers on the coin means a mode switch is exactly one movement — the two
     coin pages cross, and nothing underneath them moves at all.
     WalletHome decides who owns the close, by mode. */
  const shownCoin = activeCoin;
  /* Armed DURING RENDER rather than in an effect, because the coin can arrive
     from outside (a mode switch carrying one over) and `onContentSizeChange`
     can land before an effect would have run. */
  if (shownCoin && activeRef.current !== shownCoin && !pendingOpen.current)
    pendingOpen.current = "carry";
  activeRef.current = shownCoin;

  /* Closed for real — park back on the list. Only ever fires on a genuine
     close now, never on merely becoming the off-screen mode. */
  useEffect(() => {
    if (!shownCoin) {
      pendingOpen.current = null;
      pager.current?.scrollTo({ x: 0, animated: false });
    }
  }, [shownCoin]);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const finishClose = useCallback(() => {
    clearCloseTimer();
    if (activeRef.current === null) return;
    setActiveCoin(null);
  }, [setActiveCoin]);

  const closeCoin = useCallback(() => {
    if (activeRef.current === null) return;
    pendingOpen.current = null;
    pager.current?.scrollTo({ x: 0, animated: true });
    clearCloseTimer();
    closeTimer.current = setTimeout(finishClose, SLIDE_MS + 200);
  }, [finishClose]);

  useEffect(() => registerClose(closeCoin), [registerClose, closeCoin]);
  useEffect(() => clearCloseTimer, []);

  const openCoin = useCallback(
    (id: NetworkId) => {
      clearCloseTimer();
      pendingOpen.current = "tap";
      setActiveCoin(id);
    },
    [setActiveCoin]
  );

  const onPagerContentSize = useCallback(
    (w: number) => {
      if (pendingOpen.current && w > width * 1.5) {
        pendingOpen.current = null;
        pager.current?.scrollTo({ x: width, animated: true });
      }
    },
    [width]
  );

  const onSettled = useCallback((x: number) => {
    if (x <= 1) finishClose();
  }, [finishClose]);

  /* Is the register page standing in for the dashboard right now? Hoisted above
     the entrance animation because that animation must not run while it is. */
  const showRegister =
    regLoaded && (forceRegister || (registered.size === 0 && !skipped && !shownCoin));

  /* THE ENTRANCE RUNS WHEN THE DASHBOARD APPEARS, not when this component
     mounts — and the difference is the whole bug it fixes. On a fresh wallet
     the register page renders instead of the dashboard, so the card was not on
     screen while its 600ms entrance played out. A NATIVE-DRIVEN value does not
     write its result back to the JS side, so the value stayed 0; when the
     dashboard finally mounted (Skip, or a first registration) the card came up
     at opacity 0 and stayed there — a card-shaped hole above TOKENS. */
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showRegister) return;
    enter.setValue(0);
    const a = Animated.timing(enter, {
      toValue: 1,
      duration: 600,
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [showRegister, enter]);

  const totalUsd = useMemo(() => {
    let total = 0;
    for (const c of CHAINS) total += (Number(allBalances[c.id]) || 0) * (prices?.[c.id]?.usd ?? 0);
    return total;
  }, [allBalances, prices]);

  const formattedTotalUsd = useMemo(
    () =>
      totalUsd.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [totalUsd]
  );

  /* Gate 1 — until it is skipped, and never over a coin page. Swapping a coin
     page you navigated to for the register screen takes the decision away from
     you; the page opens and offers Register on the bar pinned at its foot. */
  if (showRegister) {
    return (
      <RegisterView
        chainsToShow={registered.size === 0 ? undefined : unregisteredIds}
        onDone={() => {
          setForceRegister(false);
          void loadRegistered();
        }}
        onSkip={() => {
          setSkipped(true);
          setForceRegister(false);
        }}
      />
    );
  }

  const activeChain = shownCoin ? CHAIN_BY_ID[shownCoin] : null;
  const coinBalance = shownCoin ? allBalances[shownCoin] || "0" : "0";
  const coinRegistered = shownCoin ? registered.has(shownCoin) : false;
  const coinActions: CoinAction[] = [
    { key: "hide", icon: <MaskIcon />, label: "Hide", onPress: () => setSheet("mask") },
    { key: "unhide", icon: <UnmaskIcon />, label: "Unhide", onPress: () => setSheet("unmask") },
    { key: "send", icon: <SendIcon />, label: "Send", onPress: () => setSheet("transfer") },
    { key: "receive", icon: <ReceiveIcon />, label: "Receive", onPress: () => setShowReceive(true) },
  ];

  const bottomPad = insets.bottom + 24;

  const featured = treasureChain === "all" ? null : treasureChain;
  const featuredChain = featured ? CHAIN_BY_ID[featured] : null;
  const featuredBalRaw = featured ? allBalances[featured] || "0" : "0";
  const featuredUsd = featured ? (Number(featuredBalRaw) || 0) * (prices?.[featured]?.usd ?? 0) : 0;
  const featuredUsdFormatted = featuredUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: featuredUsd > 0 && featuredUsd < 1 ? 4 : 2,
  });
  const tokenList = featured ? CHAINS.filter((c) => c.id !== featured) : CHAINS;

  return (
    <View style={styles.clip}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        scrollEnabled={shownCoin !== null}
        onContentSizeChange={onPagerContentSize}
        onMomentumScrollEnd={(e) => onSettled(e.nativeEvent.contentOffset.x)}
        onScrollEndDrag={(e) => onSettled(e.nativeEvent.contentOffset.x)}
        style={styles.pager}>
        {/* ── page 0 · the list ── */}
        <ScrollView
          style={{ width }}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[
              styles.cardBay,
              {
                opacity: enter,
                transform: [
                  { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
                  { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
                ],
              },
            ]}>
            <View style={styles.card}>
              <TreasureCardShell isNoid treasureChain={treasureChain} />

              <View style={styles.cardContent}>
                <Text style={styles.treasureLabel}>HIDDEN TREASURE</Text>

                {featuredChain ? (
                  <View style={styles.balanceBlock}>
                    <View style={styles.featuredRow}>
                      <AnimatedNumber
                        value={formatAssetBalance(featuredBalRaw)}
                        height={48}
                        duration={850}
                        textStyle={styles.featuredNumber}
                      />
                      <Text style={styles.featuredSymbol}>{featuredChain.symbol}</Text>
                    </View>
                    <Text style={styles.featuredUsd}>≈ {featuredUsdFormatted}</Text>
                    <Text style={styles.featuredTotal}>
                      Total balance:{" "}
                      <Text style={styles.featuredTotalValue}>{formattedTotalUsd}</Text>
                    </Text>
                  </View>
                ) : (
                  <View style={styles.balanceBlock}>
                    <AnimatedNumber
                      value={formattedTotalUsd}
                      height={62}
                      duration={850}
                      textStyle={styles.totalNumber}
                    />
                  </View>
                )}

                <CopyKeysButton addresses={addresses} isNoid />
              </View>
            </View>
          </Animated.View>

          <View style={styles.tokensHeader}>
            <Text style={styles.tokensLabel}>TOKENS</Text>
            <LinearGradient
              colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.tokensRule}
            />
          </View>

          <View style={styles.bars}>
            {tokenList.map((chain) => (
              <TokenBar
                key={chain.id}
                chain={chain}
                balance={allBalances[chain.id] || "0"}
                price={prices?.[chain.id]}
                address={realAddressFor(wallet, chain.id) ?? ""}
                registered={registered.has(chain.id)}
                onPress={() => openCoin(chain.id)}
                onRegister={() => setForceRegister(true)}
              />
            ))}
          </View>

          <View style={styles.tail} />
        </ScrollView>

        {/* ── page 1 · the coin ── */}
        {shownCoin && activeChain ? (
          <ScrollView
            style={{ width }}
            contentContainerStyle={{ paddingBottom: bottomPad }}
            showsVerticalScrollIndicator={false}>
            <CoinDetailView
              chain={activeChain}
              pageTheme="dark"
              balance={coinBalance}
              price={prices?.[shownCoin]}
              priceLoading={pricesLoading}
              balanceLabel="Your Private Balance"
              onBack={closeCoin}
              actions={coinActions}
              actionsSlot={
                coinRegistered ? undefined : (
                  <Pressable
                    onPress={() => setForceRegister(true)}
                    style={({ pressed }) => [
                      styles.regCta,
                      { transform: [{ scale: pressed ? 0.98 : 1 }] },
                    ]}>
                    <LinearGradient
                      colors={["#FBF7FF", "#C9B0FF"]}
                      start={{ x: 0.15, y: 0 }}
                      end={{ x: 0.85, y: 1 }}
                      style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
                    />
                    <Text style={styles.regCtaText}>REGISTER {activeChain.symbol}</Text>
                  </Pressable>
                )
              }
              shipsLog={<ShipsLogEntries entries={[]} isNoid network={shownCoin} />}
            />
          </ScrollView>
        ) : null}
      </ScrollView>


      <UnderDevSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        isNoid
        title={sheet === "mask" ? "Hide" : sheet === "unmask" ? "Unhide" : "Send"}
        caption={
          sheet === "mask"
            ? "Moving funds from your public balance into the private pool is being built."
            : sheet === "unmask"
              ? "Bringing private funds back out to your public balance is being built."
              : "Private sends between Menoid wallets are being built."
        }
      />

      {/* The same receive sheet open mode uses — both modes encode the same real
          address, so it is genuinely the same screen in the other palette. */}
      <ReceiveModal
        open={showReceive}
        onClose={() => setShowReceive(false)}
        mode="noid"
        address={shownCoin ? realAddressFor(wallet, shownCoin) ?? "" : ""}
      />
    </View>
  );
}

/* ───────────────────────── Token bar ─────────────────────────
   Same bar for registered and unregistered chains — solid glass, full-colour
   crest, full name. Only the right-hand control differs: a balance, or a
   Register button. A dimmed or ghosted row would read as broken. */
const TokenBar = memo(function TokenBar({
  chain,
  balance,
  price,
  address,
  registered,
  onPress,
  onRegister,
}: {
  chain: (typeof CHAINS)[number];
  balance: string;
  price?: { usd: number; change24h: number };
  address: string;
  registered: boolean;
  onPress: () => void;
  onRegister: () => void;
}) {
  const usdVal = (Number(balance) || 0) * (price?.usd ?? 0);
  const up = (price?.change24h ?? 0) >= 0;

  const crest = (
    <View style={styles.crest}>
      <LinearGradient
        colors={["#FBF7FF", "#D6C4F5"]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 12 }]}
      />
      <View style={styles.glyph}>
        <chain.Icon size={20} color="#3B2570" />
      </View>
    </View>
  );

  if (!registered) {
    /* The ROW still opens the coin page — an unregistered chain has a page like
       any other, it just cannot show a balance yet. Only the button on the
       right is a shortcut past it, straight to registering. */
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.bar, pressed && { transform: [{ scale: 0.99 }] }]}>
        <View style={styles.barLeft}>
          {crest}
          <View>
            <Text style={styles.barName}>{chain.name}</Text>
            <Text style={styles.barSubtitle}>{chain.subtitle.toUpperCase()}</Text>
          </View>
        </View>
        <Pressable
          onPress={onRegister}
          style={({ pressed }) => [styles.regBtn, { transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
          <LinearGradient
            colors={["#F4EEFF", "#C9B0FF"]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 999 }]}
          />
          <Text style={styles.regText}>REGISTER</Text>
        </Pressable>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.bar, pressed && { transform: [{ scale: 0.99 }] }]}>
      <View style={styles.barLeft}>
        {crest}
        <View>
          <View style={styles.barNameRow}>
            <Text style={styles.barName}>{chain.name}</Text>
            <InlineCopyButton value={address} fg={INK_RGB} />
          </View>
          <Text style={styles.barSubtitle}>{chain.subtitle.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.barRight}>
        <View style={styles.barFigures}>
          <View style={styles.barAmountRow}>
            <AnimatedNumber
              value={formatAssetBalance(balance)}
              height={15}
              duration={650}
              textStyle={styles.barAmount}
            />
            <Text style={styles.barSymbol}>{chain.symbol}</Text>
          </View>
          <Text
            style={[
              styles.barUsd,
              { color: usdVal > 0 ? (up ? "#6EE7A8" : "#FF8E86") : `rgba(${INK_RGB},0.5)` },
            ]}>
            {usdVal > 0
              ? `≈ ${usdVal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usdVal < 1 ? 4 : 2 })}`
              : "—"}
          </Text>
        </View>
        <Svg width={7} height={7} viewBox="0 0 10 10">
          <Path
            d="M3 1.5L6.5 5L3 8.5"
            stroke={`rgba(${INK_RGB},0.35)`}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </View>
    </Pressable>
  );
});

/* ─── action glyphs ─── */
function MaskIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 18 18">
      <Path
        d="M9 2L15 4.2V8.5C15 12 12.4 14.7 9 16C5.6 14.7 3 12 3 8.5V4.2L9 2Z"
        stroke={`rgba(${INK_RGB},0.95)`}
        strokeWidth={1.4}
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M6.4 9L8.2 10.8L11.8 7"
        stroke={`rgba(${INK_RGB},0.95)`}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
function UnmaskIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 18 18">
      <Path
        d="M2 9C2 9 4.7 4.5 9 4.5C13.3 4.5 16 9 16 9C16 9 13.3 13.5 9 13.5C4.7 13.5 2 9 2 9Z"
        stroke={`rgba(${INK_RGB},0.95)`}
        strokeWidth={1.4}
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M11.1 9A2.1 2.1 0 1 1 6.9 9a2.1 2.1 0 0 1 4.2 0Z"
        stroke={`rgba(${INK_RGB},0.95)`}
        strokeWidth={1.4}
        fill="none"
      />
    </Svg>
  );
}
/* The same two arrows open mode's Send and Receive use — the action is the
   same action, so it should not have to be relearned in the dark. */
function SendIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 18 18">
      <Path
        d="M4 14L14 4M14 4H7M14 4V11"
        stroke={`rgba(${INK_RGB},0.95)`}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
function ReceiveIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 18 18">
      <Path
        d="M14 4L4 14M4 14H11M4 14V7"
        stroke={`rgba(${INK_RGB},0.95)`}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  clip: { flex: 1, overflow: "hidden" },
  pager: { flex: 1 },
  cardBay: { paddingHorizontal: 16, paddingTop: 20 },
  card: {
    borderRadius: CARD_RADIUS,
    /* The light card's own outline for Android's elevation, same trick as open
       mode's — never visible, the shell covers it. */
    backgroundColor: "#EADFFC",
    elevation: 14,
    shadowColor: "#0C061E",
    shadowOpacity: 0.6,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
  },
  cardContent: { paddingHorizontal: 24, paddingVertical: 36 },
  treasureLabel: {
    fontFamily: FONT.roundBold,
    fontSize: 8,
    letterSpacing: 4,
    color: "rgba(78,47,142,0.55)",
    marginBottom: 14,
  },
  balanceBlock: { marginBottom: 24 },
  totalNumber: { fontFamily: FONT.roundBold, fontSize: 62, letterSpacing: -1.8, color: "#3B2570" },
  featuredRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  featuredNumber: { fontFamily: FONT.roundBold, fontSize: 48, letterSpacing: -1.4, color: "#3B2570" },
  featuredSymbol: {
    fontFamily: FONT.roundBold,
    fontSize: 18,
    color: "rgba(78,47,142,0.6)",
    marginBottom: 6,
  },
  featuredUsd: { fontFamily: FONT.mono, fontSize: 12, color: "rgba(78,47,142,0.6)", marginTop: 8 },
  featuredTotal: { fontFamily: FONT.body, fontSize: 10, color: "rgba(78,47,142,0.55)", marginTop: 2 },
  featuredTotalValue: { fontFamily: FONT.bodySemi, color: "rgba(78,47,142,0.8)" },

  tokensHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 10,
  },
  tokensLabel: {
    fontFamily: FONT.roundBold,
    fontSize: 9,
    letterSpacing: 3.6,
    color: `rgba(${INK_RGB},0.55)`,
  },
  tokensRule: { flex: 1, height: 1 },

  bars: { paddingHorizontal: 16, gap: 8 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.11)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  glyph: { zIndex: 1 },
  barLeft: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  crest: {
    height: 36,
    width: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(78,47,142,0.14)",
  },
  barNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  barName: { fontFamily: FONT.roundSemi, fontSize: 12.5, color: `rgba(${INK_RGB},0.9)` },
  barSubtitle: {
    fontFamily: FONT.mono,
    fontSize: 9,
    color: `rgba(${INK_RGB},0.55)`,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  barRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  barFigures: { alignItems: "flex-end" },
  barAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  barAmount: { fontFamily: FONT.roundBold, fontSize: 12.5, color: `rgba(${INK_RGB},0.9)` },
  barSymbol: { fontFamily: FONT.body, fontSize: 9, color: `rgba(${INK_RGB},0.55)`, marginBottom: 1 },
  barUsd: { fontFamily: FONT.mono, fontSize: 9, marginTop: 2 },

  /* Sits exactly where the four action tiles would be. */
  regCta: {
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  regCtaText: { fontFamily: FONT.roundBold, fontSize: 12.5, letterSpacing: 1.8, color: "#3B2570" },

  regBtn: {
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  regText: { fontFamily: FONT.roundBold, fontSize: 9, letterSpacing: 1.4, color: "#3B2570" },

  tail: { height: 34 },
});
