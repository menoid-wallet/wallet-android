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
 *
 * THE COIN PAGE IS A SLIDE, NOT A SHARED-ELEMENT MORPH. The treasure card used
 * to fly into the graph card and back. It was never convincing: only the card's
 * shell can be transformed (scaling type smears it), so the balance and the
 * Copy Keys cloud had to blink out before the flight and back in after it, and
 * the two halves never read as one object. A plain pair of pages — dashboard
 * left, coin page right — says the same thing without asking anything of the
 * card. Dragging the coin page right walks back.
 *
 * The slide is a PAGING SCROLLVIEW, exactly like the mode pager one level up,
 * and for the same two reasons. It is Android's own scroller, so the drag, the
 * fling and the snap all happen off the JS thread. And a PanGestureHandler can
 * NOT be used here at all: on the New Architecture, handing one an
 * `Animated.event({useNativeDriver: true})` passes the animated-event OBJECT
 * through as a plain prop, and the first touch crashes the app with
 *   "Expected `onGestureHandlerEvent` listener to be a function".
 * The nesting works because only one of the two pagers is ever enabled: this
 * one is dead until a coin is open, and the mode pager is disabled while one
 * is (WalletHome passes `scrollEnabled={!coinOpen}`), so the horizontal drag
 * always has exactly one owner.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
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
import AnimatedNumber from "../shared/AnimatedNumber";
import InlineCopyButton from "../shared/InlineCopyButton";
import CopyKeysButton from "../shared/CopyKeysButton";
import TreasureCardShell, { CARD_RADIUS } from "../shared/TreasureCardShell";
import CoinDetailView, { type CoinAction } from "../shared/CoinDetailView";
import ShipsLogEntries from "../shared/ShipsLogEntries";
import SendModal from "../shared/SendModal";
import ReceiveModal from "../shared/ReceiveModal";
import ComingSoonToast from "../shared/ComingSoonToast";
import { COLORS, FONT } from "../../theme/tokens";
import { rgba } from "../../theme/useThemeTokens";

const POLL_MS = 6_000;
const INK = COLORS.violetDeep;
const INK_RGB = "78,47,142";

/** Long enough for the pager's own scroll to land, if it never says so. */
const SLIDE_MS = 380;

const EMPTY_BALANCES: Record<NetworkId, string> = {
  monad: "0",
  sepolia: "0",
  base_sepolia: "0",
  solana: "0",
  sui: "0",
  aptos: "0",
};

export interface ModeViewProps {
  /** Told whenever a coin page opens or closes, so the shell can route Back
      and stop the mode pager from competing with the back-swipe. */
  onCoinOpenChange: (open: boolean) => void;
  /** Hands the shell a way to walk back — Android's Back must animate too. */
  registerClose: (close: () => void) => void;
}

function formatAssetBalance(b: string): string {
  const n = Number(b);
  if (!Number.isFinite(n) || n === 0) return "0.00";
  if (n < 0.01) return n.toFixed(4);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export default function OpenModeView({ onCoinOpenChange, registerClose }: ModeViewProps) {
  const { wallet, treasureChain } = useWallet();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const { prices, loading: pricesLoading } = useTokenPrices();
  const [balances, setBalances] = useState<Record<NetworkId, string>>(EMPTY_BALANCES);
  const mountedRef = useRef(true);

  const [activeCoin, setActiveCoin] = useState<NetworkId | null>(null);
  const [txEntries, setTxEntries] = useState<TxEntry[]>([]);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [toast, setToast] = useState(false);

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

  /* The signing account for a chain. The three EVM networks share one — which
     is exactly why the ship's log is keyed by address AND network, and not by
     address alone; see lib/txStore. */
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
     Hydrated from disk once per sender-and-chain, then kept live by the store's
     own subscription so a send that just landed shows up without a refetch.
     BOTH halves of that key matter: Monad, Sepolia and Base Sepolia are signed
     by one EVM account, so keying on the address alone showed every EVM send in
     all three logs. */
  const logAddress = activeCoin ? addressFor(activeCoin) : "";
  useEffect(() => {
    if (!logAddress || !activeCoin) {
      // Never leave the last coin's log standing behind the next one.
      setTxEntries([]);
      return;
    }
    let alive = true;
    const sync = () => {
      if (alive) setTxEntries(loadOpenTxns(logAddress, activeCoin));
    };
    void hydrateOpenTxns(logAddress, activeCoin).then(sync);
    const off = subscribeTxns(sync);
    return () => {
      alive = false;
      off();
    };
  }, [logAddress, activeCoin]);

  /* ── The slide ──
     Page 0 is the list, page 1 is the coin. Opening is a scrollTo; walking back
     is either a scrollTo or the user's own thumb, and both land in the same
     place — `onSettled`, which reads where the pager actually stopped rather
     than assuming. Page 1 is only MOUNTED while it is needed, so opening has to
     wait for it to exist before it can scroll to it: `onContentSizeChange` is
     that signal, and it is exact where a requestAnimationFrame would be a
     guess. */
  const pager = useRef<ScrollView>(null);
  const pendingOpen = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<NetworkId | null>(null);
  activeRef.current = activeCoin;

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  /* Drop page 1 — only ever once the pager is back on the list, never during
     the slide, or the way back would be a slide over a blank half. */
  const finishClose = useCallback(() => {
    clearCloseTimer();
    if (activeRef.current === null) return;
    setActiveCoin(null);
    onCoinOpenChange(false);
  }, [onCoinOpenChange]);

  const openCoin = useCallback(
    (id: NetworkId) => {
      clearCloseTimer();
      pendingOpen.current = true;
      setActiveCoin(id);
      onCoinOpenChange(true);
    },
    [onCoinOpenChange]
  );

  const closeCoin = useCallback(() => {
    if (activeRef.current === null) return;
    pendingOpen.current = false;
    pager.current?.scrollTo({ x: 0, animated: true });
    clearCloseTimer();
    // A backstop only: onSettled normally gets there first.
    closeTimer.current = setTimeout(finishClose, SLIDE_MS + 200);
  }, [finishClose]);

  useEffect(() => registerClose(closeCoin), [registerClose, closeCoin]);
  useEffect(() => clearCloseTimer, []);

  const onPagerContentSize = useCallback(
    (w: number) => {
      if (pendingOpen.current && w > width * 1.5) {
        pendingOpen.current = false;
        pager.current?.scrollTo({ x: width, animated: true });
      }
    },
    [width]
  );

  /** Landed back on the list — by scrollTo, by Back, or by the user's thumb. */
  const onSettled = useCallback(
    (x: number) => {
      if (x <= 1) finishClose();
    },
    [finishClose]
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
  const coinAccount = activeCoin ? accountFor(activeCoin) : undefined;
  const coinBalance = activeCoin ? balances[activeCoin] || "0" : "0";
  const coinActions: CoinAction[] = [
    { key: "send", icon: <SendIcon />, label: "Send", onPress: () => setShowSend(true) },
    { key: "receive", icon: <ReceiveIcon />, label: "Receive", onPress: () => setShowReceive(true) },
    { key: "buy", icon: <BuyIcon />, label: "Buy", tone: "muted", onPress: () => setToast(true) },
  ];

  const bottomPad = insets.bottom + 24;

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

  // ── The two pages ─────────────────────────────────────────────────────────
  return (
    <View style={styles.clip}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        /* Dead until a coin is open, so on the list the horizontal drag belongs
           to the mode pager above and nothing competes for it. */
        scrollEnabled={activeCoin !== null}
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
          <TreasureCardShell isNoid={false} treasureChain={treasureChain} />

          <View style={styles.cardContent}>
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
          </View>
        </View>
      </Animated.View>

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
            onPress={() => openCoin(chain.id)}
          />
        ))}
      </View>

      <View style={styles.tail} />
        </ScrollView>

        {/* ── page 1 · the coin ──
            Mounted only while it is needed, and torn down after the pager has
            slid home rather than before it, so the way back is never a slide
            over an empty half. A fresh mount each time is also why it always
            opens scrolled to the top. */}
        {activeCoin && activeChain ? (
          <ScrollView
            style={{ width }}
            contentContainerStyle={{ paddingBottom: bottomPad }}
            showsVerticalScrollIndicator={false}>
            <CoinDetailView
              chain={activeChain}
              pageTheme="light"
              balance={coinBalance}
              price={prices?.[activeCoin]}
              priceLoading={pricesLoading}
              balanceLabel="Your Balance"
              onBack={closeCoin}
              actions={coinActions}
              shipsLog={<ShipsLogEntries entries={txEntries} isNoid={false} network={activeCoin} />}
            />
          </ScrollView>
        ) : null}
      </ScrollView>

      {activeCoin && activeChain && (
        <>
          <SendModal
            open={showSend}
            onClose={() => setShowSend(false)}
            chain={activeChain}
            network={activeCoin}
            fromAddress={coinAccount?.address ?? ""}
            privateKey={coinAccount?.privateKey ?? ""}
            balance={coinBalance}
            usdPrice={prices?.[activeCoin]?.usd ?? 0}
            onSent={() => void fetchAllBalances()}
          />
          <ReceiveModal
            open={showReceive}
            onClose={() => setShowReceive(false)}
            mode="open"
            address={coinAccount?.address ?? ""}
          />
          <ComingSoonToast
            show={toast}
            onDone={() => setToast(false)}
            message="Buying is on the horizon. Coming soon."
          />
        </>
      )}
    </View>
  );
}

/* ───────────────────────── Token bar ───────────────────────── */
const TokenBar = memo(function TokenBar({
  chain,
  balance,
  price,
  address,
  onPress,
}: {
  chain: (typeof CHAINS)[number];
  balance: string;
  price?: { usd: number; change24h: number };
  address: string;
  onPress: () => void;
}) {
  const usdVal = (Number(balance) || 0) * (price?.usd ?? 0);
  const up = (price?.change24h ?? 0) >= 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.bar, pressed && { transform: [{ scale: 0.99 }] }]}>
      <View style={styles.barLeft}>
        <View style={styles.crest}>
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
  clip: { flex: 1, overflow: "hidden" },
  pager: { flex: 1 },
  cardBay: { paddingHorizontal: 16, paddingTop: 20 },
  card: {
    borderRadius: CARD_RADIUS,
    /* Android derives an elevation shadow from the view's OUTLINE, which it
       only has when the view has a background — the gradient lives in a child
       and does not count. Never visible: the shell covers it completely. */
    backgroundColor: "#2B1A55",
    elevation: 14,
    shadowColor: "#1E0E46",
    shadowOpacity: 0.5,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
  },
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
