/**
 * OpenModeView.tsx — the public treasury.
 *
 * Ported from the extension's components/modes/OpenModeView.tsx. Light page,
 * dark treasury card; live mainnet prices value the real (but worthless)
 * testnet balances. Tapping a token bar opens that coin's page — which is a
 * placeholder for now, so this milestone ships the dashboard only.
 *
 * The balance poll is the extension's, with one change: it skipped a round when
 * `document.hidden`, and the phone's equivalent question is AppState. A
 * backgrounded wallet must not keep six chains' RPCs warm.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import { useWallet } from "../../context/WalletContext";
import { getBalance } from "../../lib/rpc";
import { NETWORKS, type NetworkId } from "../../lib/networks";
import { CHAINS, CHAIN_BY_ID } from "../../lib/chains";
import { useTokenPrices } from "../../lib/usePrices";
import {
  hydrateOpenTxns,
  loadOpenTxns,
  subscribeTxns,
  type TxEntry,
} from "../../lib/txStore";
import {
  measureRect,
  flipTransform,
  FLIP_CARD_EASING,
  FLIP_CARD_MS,
  type Rect,
} from "../../lib/flip";
import AnimatedNumber from "../shared/AnimatedNumber";
import InlineCopyButton from "../shared/InlineCopyButton";
import CopyKeysButton from "../shared/CopyKeysButton";
import TreasureCardShell, { CARD_RADIUS } from "../shared/TreasureCardShell";
import CoinDetailView, { type CoinAction, type MorphSource } from "../shared/CoinDetailView";
import ShipsLogEntries from "../shared/ShipsLogEntries";
import SendModal from "../shared/SendModal";
import ReceiveModal from "../shared/ReceiveModal";
import ComingSoonToast from "../shared/ComingSoonToast";
import { COLORS, FONT } from "../../theme/tokens";
import { rgba } from "../../theme/useThemeTokens";

const POLL_MS = 6_000;
const INK = COLORS.violetDeep;
const INK_RGB = "78,47,142";

const EMPTY_BALANCES: Record<NetworkId, string> = {
  monad: "0",
  sepolia: "0",
  base_sepolia: "0",
  solana: "0",
  sui: "0",
  aptos: "0",
};

export interface ModeViewProps {
  /** lifted to WalletHome so the open coin survives an open↔noid switch */
  activeCoin: NetworkId | null;
  setActiveCoin: (c: NetworkId | null) => void;
  /** puts the body scroll back at the top when the page changes */
  scrollToTop: () => void;
}

function formatAssetBalance(b: string): string {
  const n = Number(b);
  if (!Number.isFinite(n) || n === 0) return "0.00";
  if (n < 0.01) return n.toFixed(4);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export default function OpenModeView({ activeCoin, setActiveCoin, scrollToTop }: ModeViewProps) {
  const { wallet, treasureChain } = useWallet();

  const { prices, loading: pricesLoading } = useTokenPrices();
  const [balances, setBalances] = useState<Record<NetworkId, string>>(EMPTY_BALANCES);
  const mountedRef = useRef(true);

  /* Shared-element state. `morph` is captured at tap time — where the treasure
     card and the tapped crest WERE — and handed to the coin page to grow out of.
     `reverseMorph` is the same handshake in the other direction. */
  const [morph, setMorph] = useState<MorphSource | null>(null);
  const [reverseMorph, setReverseMorph] = useState<Rect | null>(null);
  const [txEntries, setTxEntries] = useState<TxEntry[]>([]);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [toast, setToast] = useState(false);

  const treasureRef = useRef<View>(null);
  const barRefs = useRef<Record<string, View | null>>({});

  const addresses = useMemo(
    () => ({
      evm: wallet?.normalAccount?.address ?? "",
      solana: wallet?.solanaAccount?.address ?? "",
      sui: wallet?.suiAccount?.address ?? "",
      aptos: wallet?.aptosAccount?.address ?? "",
    }),
    [wallet]
  );

  const addressFor = useCallback(
    (id: NetworkId) =>
      id === "solana" ? addresses.solana : id === "sui" ? addresses.sui : id === "aptos" ? addresses.aptos : addresses.evm,
    [addresses]
  );

  /* The signing account for a chain. The three EVM networks share one, which is
     also why their ship's logs are shared — the log is keyed by address. */
  const accountFor = useCallback(
    (id: NetworkId) =>
      id === "solana"
        ? wallet?.solanaAccount
        : id === "sui"
          ? wallet?.suiAccount
          : id === "aptos"
            ? wallet?.aptosAccount
            : wallet?.normalAccount,
    [wallet]
  );

  const fetchAllBalances = useCallback(async () => {
    if (!wallet) return;
    const results = await Promise.all(
      (Object.keys(NETWORKS) as NetworkId[]).map(async (netId) => {
        const addr = addressFor(netId);
        if (!addr) return { netId, balance: "0" };
        try {
          return { netId, balance: await getBalance(addr, netId) };
        } catch (e) {
          console.error(`Error fetching balance for ${netId}:`, e);
          return { netId, balance: "0" };
        }
      })
    );
    if (!mountedRef.current) return;
    setBalances((prev) => {
      const next = { ...prev };
      for (const r of results) next[r.netId] = r.balance;
      return next;
    });
  }, [wallet, addressFor]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchAllBalances();
    const id = setInterval(() => {
      if (AppState.currentState === "active") void fetchAllBalances();
    }, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchAllBalances]);

  /* The treasure card's entrance, in its OWN effect with an empty dep array.
     In the extension it rode along in the polling effect, whose deps change
     whenever the wallet object's identity does — so the cleanup kept cancelling
     the pending timer and the card sat invisible. Entrance is a mount concern
     and does not belong on a dependency list with anything else. */
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 600,
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  /* ── Ship's log ──
     Hydrated from disk once per address, then kept live by the store's own
     subscription so a send that just landed shows up without a refetch. */
  const logAddress = activeCoin ? addressFor(activeCoin) : "";
  useEffect(() => {
    if (!logAddress) return;
    let alive = true;
    const sync = () => {
      if (alive) setTxEntries(loadOpenTxns(logAddress));
    };
    void hydrateOpenTxns(logAddress).then(sync);
    const off = subscribeTxns(sync);
    return () => {
      alive = false;
      off();
    };
  }, [logAddress]);

  /* ── Reverse morph ──
     Coming back from the coin page, the treasure card grows OUT of wherever the
     graph card just was. A ref guard stops a re-render from replaying it. */
  const reverse = useRef(new Animated.Value(1)).current;
  const [reverseT, setReverseT] = useState<ReturnType<typeof flipTransform>>(null);
  const consumedReverse = useRef<Rect | null>(null);

  /* DERIVED DURING RENDER, NOT SET IN AN EFFECT. Effects run after the frame is
     painted, so hiding the shell from one meant the card was drawn at rest for
     a frame, vanished, and only then flew in — the "it's there, then it isn't,
     then it arrives" flicker. A rect is waiting and no transform exists yet is
     something this render already knows. */
  const shellHidden = reverseMorph != null && reverseT == null;

  /* The card's CONTENT does not morph — scaling type would smear it — so it
     cross-fades instead: out before we leave, back in a beat behind the card on
     the way home, so it looks like it is riding the card rather than being
     switched off and on underneath it. */
  const contentFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (activeCoin || !reverseMorph || consumedReverse.current === reverseMorph) return;
    consumedReverse.current = reverseMorph;
    let cancelled = false;

    void (async () => {
      const to = await measureRect(treasureRef.current);
      const tr = to ? flipTransform(reverse, reverseMorph, to) : null;
      if (cancelled) return;
      if (!tr) {
        // Nothing to fly from — show the card rather than stranding it hidden.
        setReverseMorph(null);
        return;
      }
      reverse.setValue(0);
      setReverseT(tr);
      Animated.timing(reverse, {
        toValue: 1,
        duration: FLIP_CARD_MS,
        easing: FLIP_CARD_EASING,
        useNativeDriver: true,
      }).start(() => {
        if (cancelled) return;
        setReverseT(null);
        setReverseMorph(null);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCoin, reverseMorph, reverse]);

  /* Bring the dashboard's content back whenever we land on it, morph or no
     morph — Android's Back returns without a rect, and the content must not be
     left faded out in that case. It trails the card by a beat when there IS a
     card flying home. */
  useEffect(() => {
    if (activeCoin) return;
    const a = Animated.timing(contentFade, {
      toValue: 1,
      duration: 360,
      delay: reverseMorph ? 170 : 0,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
    // Only on arrival; reverseMorph is read once, as it stands at that moment.
  }, [activeCoin, contentFade]);

  /* Leaving: measure where things ARE, fade the content off the card, and only
     then navigate. Cutting straight to the coin page left the card's contents
     blinking out of existence while an empty shell resized — the "stutter". The
     shell itself stays put through the fade, so the object never disappears. */
  const openCoin = useCallback(
    async (id: NetworkId) => {
      const [card, icon] = await Promise.all([
        measureRect(treasureRef.current),
        measureRect(barRefs.current[id] ?? null),
      ]);
      setMorph({ card, icon });
      Animated.timing(contentFade, {
        toValue: 0,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setActiveCoin(id);
        scrollToTop();
      });
    },
    [setActiveCoin, scrollToTop, contentFade]
  );

  const totalUsd = useMemo(() => {
    let total = 0;
    for (const c of CHAINS) total += (Number(balances[c.id]) || 0) * (prices?.[c.id]?.usd ?? 0);
    return total;
  }, [balances, prices]);

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

  // ── Coin page ─────────────────────────────────────────────────────────────
  const activeChain = activeCoin ? CHAIN_BY_ID[activeCoin] : null;
  if (activeCoin && activeChain) {
    const bal = balances[activeCoin] || "0";
    const account = accountFor(activeCoin);
    const actions: CoinAction[] = [
      { key: "send", icon: <SendIcon />, label: "Send", onPress: () => setShowSend(true) },
      { key: "receive", icon: <ReceiveIcon />, label: "Receive", onPress: () => setShowReceive(true) },
      { key: "buy", icon: <BuyIcon />, label: "Buy", tone: "muted", onPress: () => setToast(true) },
    ];

    return (
      <CoinDetailView
        chain={activeChain}
        pageTheme="light"
        balance={bal}
        price={prices?.[activeCoin]}
        priceLoading={pricesLoading}
        balanceLabel="Your Balance"
        morph={morph}
        onBack={(graphRect) => {
          setReverseMorph(graphRect);
          setActiveCoin(null);
          setMorph(null);
          scrollToTop();
        }}
        actions={actions}
        shipsLog={<ShipsLogEntries entries={txEntries} isNoid={false} network={activeCoin} />}>
        <SendModal
          open={showSend}
          onClose={() => setShowSend(false)}
          chain={activeChain}
          network={activeCoin}
          fromAddress={account?.address ?? ""}
          privateKey={account?.privateKey ?? ""}
          balance={bal}
          usdPrice={prices?.[activeCoin]?.usd ?? 0}
          onSent={() => void fetchAllBalances()}
        />
        <ReceiveModal
          open={showReceive}
          onClose={() => setShowReceive(false)}
          mode="open"
          address={account?.address ?? ""}
        />
        <ComingSoonToast
          show={toast}
          onDone={() => setToast(false)}
          message="Buying is on the horizon. Coming soon."
        />
      </CoinDetailView>
    );
  }

  // ── Featured (treasure-card) chain ────────────────────────────────────────
  // A specific chain shows its native balance front-and-centre and drops its
  // own bar from the token list; "all" keeps the combined USD total + all bars.
  const featured = treasureChain === "all" ? null : treasureChain;
  const featuredChain = featured ? CHAIN_BY_ID[featured] : null;
  const featuredBalRaw = featured ? balances[featured] || "0" : "0";
  const featuredUsd = featured ? (Number(featuredBalRaw) || 0) * (prices?.[featured]?.usd ?? 0) : 0;
  const featuredUsdFormatted = featuredUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: featuredUsd > 0 && featuredUsd < 1 ? 4 : 2,
  });
  const tokenList = featured ? CHAINS.filter((c) => c.id !== featured) : CHAINS;

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <View>
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
          {/* The shell is the reverse-morph target: the card the coin page's
              graph card shrinks back into. Only the SHELL is transformed —
              scaling the content would squash the balance mid-flight. */}
          <Animated.View
            ref={treasureRef}
            collapsable={false}
            style={[
              styles.shellBay,
              shellHidden && styles.preMorph,
              reverseT
                ? {
                    transform: [
                      { translateX: reverseT.translateX },
                      { translateY: reverseT.translateY },
                      { scaleX: reverseT.scaleX },
                      { scaleY: reverseT.scaleY },
                    ],
                  }
                : null,
            ]}>
            <TreasureCardShell isNoid={false} treasureChain={treasureChain} />
          </Animated.View>

          <Animated.View style={[styles.cardContent, { opacity: contentFade }]}>
            <Text style={styles.treasureLabel}>TREASURE</Text>

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
                  Total balance: <Text style={styles.featuredTotalValue}>{formattedTotalUsd}</Text>
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

            <CopyKeysButton addresses={addresses} isNoid={false} />
          </Animated.View>
        </View>
      </Animated.View>

      {/* The list goes with the card's content — the whole page clears, leaving
          only the card and the sky, and then the card leaves too. */}
      <Animated.View style={{ opacity: contentFade }}>
      {/* Tokens header */}
      <View style={styles.tokensHeader}>
        <Text style={styles.tokensLabel}>TOKENS</Text>
        <LinearGradient
          colors={["rgba(78,47,142,0.22)", "rgba(78,47,142,0)"]}
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
            balance={balances[chain.id] || "0"}
            price={prices?.[chain.id]}
            address={addressFor(chain.id)}
            crestRef={(v) => {
              barRefs.current[chain.id] = v;
            }}
            onPress={() => void openCoin(chain.id)}
          />
        ))}
      </View>

      <View style={styles.tail} />
      </Animated.View>
    </View>
  );
}

/* ───────────────────────── Token bar ───────────────────────── */
const TokenBar = memo(function TokenBar({
  chain,
  balance,
  price,
  address,
  crestRef,
  onPress,
}: {
  chain: (typeof CHAINS)[number];
  balance: string;
  price?: { usd: number; change24h: number };
  address: string;
  /** the crest is the flying element — the page above measures it by this ref */
  crestRef: (v: View | null) => void;
  onPress: () => void;
}) {
  const usdVal = (Number(balance) || 0) * (price?.usd ?? 0);
  const up = (price?.change24h ?? 0) >= 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.bar, pressed && { transform: [{ scale: 0.99 }] }]}>
      <View style={styles.barLeft}>
        <View ref={crestRef} collapsable={false} style={styles.crest}>
          <LinearGradient
            colors={["#6247A8", "#3B2570"]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 12 }]}
          />
          <View style={styles.glyph}>
            <chain.Icon size={20} color="#F4EEFF" />
          </View>
        </View>
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
              { color: usdVal > 0 ? (up ? "#1F7A55" : "#B2382A") : rgba(INK_RGB, 0.5) },
            ]}>
            {usdVal > 0
              ? `≈ ${usdVal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usdVal < 1 ? 4 : 2 })}`
              : "—"}
          </Text>
        </View>
        <Svg width={7} height={7} viewBox="0 0 10 10">
          <Path
            d="M3 1.5L6.5 5L3 8.5"
            stroke={rgba(INK_RGB, 0.35)}
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
function SendIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 18 18">
      <Path
        d="M4 14L14 4M14 4H7M14 4V11"
        stroke={rgba(INK_RGB, 0.95)}
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
        stroke={rgba(INK_RGB, 0.95)}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
function BuyIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 18 18">
      <Path
        d="M2.5 4.5h13v9h-13z"
        stroke={rgba(INK_RGB, 0.45)}
        strokeWidth={1.5}
        fill="none"
        strokeLinejoin="round"
      />
      <Path d="M2.5 7.5H15.5" stroke={rgba(INK_RGB, 0.45)} strokeWidth={1.5} />
      <Path d="M5 11H8" stroke={rgba(INK_RGB, 0.45)} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  /* ── treasure card ── */
  /* The card's SOLID BODY lives here, on the view that the reverse morph
     transforms — not on the static parent. Android derives an elevation shadow
     from a view's outline, which it only has when the view has a background, so
     that background used to sit on the parent... where it stayed put while the
     shell flew home, leaving a black card already in place with a second one
     sailing towards it. It travels with the shell now. */
  shellBay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: CARD_RADIUS,
    backgroundColor: "#2B1A55",
    elevation: 14,
    shadowColor: "#1E0E46",
    shadowOpacity: 0.5,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
  },
  /** Held back until the reverse-morph transform exists. */
  preMorph: { opacity: 0 },
  cardBay: { paddingHorizontal: 16, paddingTop: 20 },
  card: { borderRadius: CARD_RADIUS },
  cardContent: { paddingHorizontal: 24, paddingVertical: 36 },
  treasureLabel: {
    fontFamily: FONT.roundBold,
    fontSize: 8,
    letterSpacing: 4,
    color: "rgba(255,255,255,0.45)",
    marginBottom: 14,
  },
  balanceBlock: { marginBottom: 24 },
  totalNumber: {
    fontFamily: FONT.roundBold,
    fontSize: 62,
    letterSpacing: -1.8,
    color: "#FFFFFF",
  },
  featuredRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  featuredNumber: {
    fontFamily: FONT.roundBold,
    fontSize: 48,
    letterSpacing: -1.4,
    color: "#FFFFFF",
  },
  featuredSymbol: {
    fontFamily: FONT.roundBold,
    fontSize: 18,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 6,
  },
  featuredUsd: { fontFamily: FONT.mono, fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 8 },
  featuredTotal: { fontFamily: FONT.body, fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 },
  featuredTotalValue: { fontFamily: FONT.bodySemi, color: "rgba(255,255,255,0.75)" },

  /* ── tokens ── */
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
    color: rgba(INK_RGB, 0.55),
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
    backgroundColor: "rgba(255,255,255,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.62)",
  },
  /* The crest glyph needs its own View. A bare <Svg> is an unpositioned node,
     and an absolutely-positioned sibling — the chip's gradient — paints ABOVE
     unpositioned content no matter the order it was written in, which hid every
     chain crest behind its own chip. A View is positioned, so ordinary
     document order applies again and the glyph lands on top of the gradient. */
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
    borderColor: "rgba(255,255,255,0.2)",
  },
  barNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  barName: { fontFamily: FONT.roundSemi, fontSize: 12.5, color: rgba(INK_RGB, 0.9) },
  barSubtitle: {
    fontFamily: FONT.mono,
    fontSize: 9,
    color: rgba(INK_RGB, 0.55),
    letterSpacing: 0.8,
    marginTop: 2,
  },
  barRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  barFigures: { alignItems: "flex-end" },
  barAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  barAmount: { fontFamily: FONT.roundBold, fontSize: 12.5, color: rgba(INK_RGB, 0.9) },
  barSymbol: { fontFamily: FONT.body, fontSize: 9, color: rgba(INK_RGB, 0.55), marginBottom: 1 },
  barUsd: { fontFamily: FONT.mono, fontSize: 9, marginTop: 2 },

  tail: { height: 34 },
});
