/**
 * WalletHome.tsx — the unlocked wallet.
 *
 * Ported from the extension's components/WalletHome.tsx: a header that is a
 * WASH rather than a bar (opaque at the top, gone by the bottom, so content
 * scrolls up into the sky instead of under a hard edge), and a body that holds
 * the two mode views.
 *
 * The header's three controls are the extension's three:
 *   left   — the brand cluster IS the wallet switcher (mark + wordmark + name)
 *   centre — the open ↔ noid pill
 *   right  — settings, which flips to a close glyph while settings is open
 *
 * THE BODY IS A TWO-PAGE PAGER, NOT A SWAP. Open is page 0 and noid is page 1,
 * and the mode is simply which one the pager is scrolled to. That is what lets
 * the switch be a gesture: the pill's knob, the ink and the SKY all read the
 * pager's offset (lib/modeMotion), so they move with the page under your thumb
 * and the mode is wherever you let go. Tapping the pill is the same motion with
 * the finger left out — it just calls scrollTo.
 *
 * It is a ScrollView rather than a pan gesture for a measured reason; see the
 * header of lib/modeMotion.ts.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWallet, type WalletMode } from "../context/WalletContext";
import { useBackHandler } from "../lib/useBackHandler";
import { modeMix, onModeScroll, setModeWidth } from "../lib/modeMotion";
import AnimatedLogo from "./brand/AnimatedLogo";
import MenoidWordmark from "./brand/MenoidWordmark";
import OpenModeView from "./modes/OpenModeView";
import NoidModeView from "./modes/NoidModeView";
import AccountsSheet from "./AccountsSheet";
import UnderDevPanel from "./shared/UnderDevPanel";
import { FONT } from "../theme/tokens";
import { HEADER_WASH, rgba, themeTokens } from "../theme/useThemeTokens";

const EASE = Easing.bezier(0.65, 0, 0.35, 1);
const MODE_SWITCH_MS = 520;

type Tab = "wallet" | "settings";

const OPEN = themeTokens(false);
const NOID = themeTokens(true);

/** Interpolate one token between the two palettes. */
function tween(mix: Animated.Value, pick: (t: typeof OPEN) => string) {
  return mix.interpolate({ inputRange: [0, 1], outputRange: [pick(OPEN), pick(NOID)] });
}

export default function WalletHome({
  onLock,
  arrive,
}: {
  onLock: () => void;
  /**
   * The hand-over, 0 → 1, owned by App and shared with the lock screen — see
   * the note there. At 0 this screen is parked off to the right and smaller; at
   * 1 it is home and full size. It sits at 0 for as long as it takes to mount,
   * which is the point: the arrival cannot quietly play out behind a lock
   * screen that has not started to leave, which is what made it look like the
   * wallet was simply already there.
   */
  arrive?: Animated.Value;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { mode, setMode, activeEntry } = useWallet();

  const [tab, setTab] = useState<Tab>("wallet");
  const [accountsOpen, setAccountsOpen] = useState(false);
  /* The coin page lives inside OpenModeView now (it is a page of that view's
     own slide). All this level needs to know is whether one is open — to route
     Back into it, and to stop the mode pager competing with its back-swipe. */
  const [coinOpen, setCoinOpen] = useState(false);
  const closeCoin = useRef<() => void>(() => {});
  const registerClose = useCallback((fn: () => void) => {
    closeCoin.current = fn;
  }, []);

  const isNoid = mode === "noid";
  const settingsOpen = tab === "settings";

  useEffect(() => setModeWidth(width), [width]);

  /* ── Colour cross-fade ──
     `mixN` is the pager's position, native, and everything that can be said as
     an opacity or a transform reads it directly — so the sky, the knob and the
     ink all move with the page under your thumb. `mixC` is its JS-driver twin,
     carrying only the colour interpolations RN cannot hand to the native side.
     A single value cannot serve both; RN refuses to mix drivers on one node. */
  const mixN = modeMix;
  const mixC = useRef(new Animated.Value(isNoid ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(mixC, {
      toValue: isNoid ? 1 : 0,
      duration: MODE_SWITCH_MS,
      easing: EASE,
      useNativeDriver: false,
    }).start();
  }, [isNoid, mixC]);

  // ── The pager ────────────────────────────────────────────────────────────
  const pager = useRef<ScrollView>(null);

  /** Tapping the pill is the same motion as dragging — it just scrolls for you. */
  const goToMode = useCallback(
    (m: WalletMode) => {
      pager.current?.scrollTo({ x: m === "noid" ? width : 0, animated: true });
      setMode(m);
    },
    [setMode, width]
  );

  /* Where the fling actually landed. Android decides that, not us, so the mode
     is read back off the pager rather than predicted from the gesture. */
  const onPagerSettled = useCallback(
    (x: number) => {
      const landed: WalletMode = Math.round(x / width) === 1 ? "noid" : "open";
      if (landed !== mode) setMode(landed);
    },
    [mode, setMode, width]
  );

  useBackHandler(
    useCallback(() => {
      if (accountsOpen) { setAccountsOpen(false); return true; }
      if (coinOpen) { closeCoin.current(); return true; }
      if (settingsOpen) { setTab("wallet"); return true; }
      return false; // home, nothing stacked — let Android leave the app
    }, [accountsOpen, coinOpen, settingsOpen])
  );

  /* ── Arrival ──
     In from the right as the lock screen slides out to the left, GROWING to
     full size as it comes: the slide says "next screen", the scale says "and
     this one is the wallet opening up". Both are the one shared value, so the
     two screens tile with no seam. Standalone (no `arrive` passed) it is simply
     already home. */
  const parked = useRef(new Animated.Value(1)).current;
  const at = arrive ?? parked;

  return (
    <Animated.View
      style={[
        styles.root,
        {
          /* Only enough of a fade to cover the very first frame — the slide is
             what carries it, not a cross-dissolve. */
          opacity: at.interpolate({ inputRange: [0, 0.12], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [
            { translateX: at.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) },
            { scale: at.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
          ],
        },
      ]}>
      {/* ─── Header ─── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, mixN) }]}>
          <LinearGradient
            colors={HEADER_WASH.open as unknown as readonly [string, string, ...string[]]}
            locations={HEADER_WASH.locations as unknown as readonly [number, number, ...number[]]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: mixN }]}>
          <LinearGradient
            colors={HEADER_WASH.noid as unknown as readonly [string, string, ...string[]]}
            locations={HEADER_WASH.locations as unknown as readonly [number, number, ...number[]]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Brand cluster — the whole thing IS the wallet switcher */}
        <Pressable
          onPress={() => setAccountsOpen(true)}
          hitSlop={6}
          style={({ pressed }) => [styles.brand, pressed && styles.pressed]}>
          <AnimatedLogo size={33} blink />
          <View style={styles.brandText}>
            {/* Both tones stay mounted and cross-fade, so the wordmark tracks
                the sky changing rather than snapping to the wrong ink. */}
            <View style={styles.wordmarkBay}>
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, mixN) }]}>
                <MenoidWordmark width={70} tone="violet" />
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: mixN }]}>
                <MenoidWordmark width={70} tone="light" />
              </Animated.View>
            </View>
            {!!activeEntry && (
              <Animated.Text
                numberOfLines={1}
                style={[styles.walletName, { color: tween(mixC, (x) => rgba(x.inkRgb, 0.68)) }]}>
                {activeEntry.name.toLowerCase()}
              </Animated.Text>
            )}
          </View>
        </Pressable>

        <ModePill onSwitch={goToMode} mixN={mixN} mixC={mixC} />

        {/* Settings — flips to a close glyph while settings is open */}
        <Pressable
          onPress={() => setTab(settingsOpen ? "wallet" : "settings")}
          hitSlop={8}
          style={({ pressed }) => [pressed && styles.pressed]}>
          <Animated.View
            style={[
              styles.gear,
              {
                backgroundColor: settingsOpen
                  ? tween(mixC, (x) => rgba(x.accentRgb, 0.22))
                  : tween(mixC, (x) => x.glass),
                borderColor: settingsOpen
                  ? tween(mixC, (x) => rgba(x.accentRgb, 0.5))
                  : tween(mixC, (x) => x.glassLine),
              },
            ]}>
            <Animated.View style={[styles.iconBay, { opacity: Animated.subtract(1, mixN) }]}>
              {settingsOpen ? <CloseGlyph color={OPEN.ink} /> : <GearGlyph color={OPEN.ink} />}
            </Animated.View>
            <Animated.View style={[styles.iconBay, { opacity: mixN }]}>
              {settingsOpen ? <CloseGlyph color={NOID.ink} /> : <GearGlyph color={NOID.ink} />}
            </Animated.View>
          </Animated.View>
        </Pressable>
      </View>

      {/* ─── Body ─── */}
      {settingsOpen ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}>
          <SettingsPlaceholder isNoid={isNoid} onLock={onLock} />
        </ScrollView>
      ) : (
        /* The carousel. Android's own scroller runs the drag, the fling and the
           snap, and `onModeScroll` feeds its offset to the native animation
           driver — which is why the sky can follow your thumb without costing
           the JS thread a single frame. See lib/modeMotion. */
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!coinOpen && !accountsOpen}
          scrollEventThrottle={16}
          onScroll={onModeScroll}
          onMomentumScrollEnd={(e) => onPagerSettled(e.nativeEvent.contentOffset.x)}
          onScrollEndDrag={(e) => onPagerSettled(e.nativeEvent.contentOffset.x)}
          contentOffset={{ x: isNoid ? width : 0, y: 0 }}
          style={styles.body}>
          {/* OpenModeView owns its own scrolling: it is two pages on a slide,
              and each needs to scroll on its own. */}
          <View style={{ width }}>
            <OpenModeView onCoinOpenChange={setCoinOpen} registerClose={registerClose} />
          </View>

          <ScrollView
            style={{ width }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}>
            <NoidModeView />
          </ScrollView>
        </Animated.ScrollView>
      )}

      <AccountsSheet open={accountsOpen} onClose={() => setAccountsOpen(false)} isNoid={isNoid} />
    </Animated.View>
  );
}

/* ───────────────────────── Mode pill ─────────────────────────
   The knob is the darker of the two skies in open mode and the brighter one in
   noid — it always reads as "the other weather", which is the thing the control
   actually promises. It rides `mixN`, so it slides with the swipe too. */
const PILL_W = 116;
const KNOB_W = 54;

function ModePill({
  onSwitch,
  mixN,
  mixC,
}: {
  onSwitch: (m: WalletMode) => void;
  mixN: Animated.AnimatedInterpolation<number>;
  mixC: Animated.Value;
}) {
  return (
    <Animated.View
      style={[
        styles.pill,
        {
          backgroundColor: tween(mixC, (x) => x.glass),
          borderColor: tween(mixC, (x) => x.glassLine),
        },
      ]}>
      <Animated.View
        style={[
          styles.knob,
          {
            transform: [
              { translateX: mixN.interpolate({ inputRange: [0, 1], outputRange: [0, 55] }) },
            ],
          },
        ]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, mixN) }]}>
          <LinearGradient
            colors={["#5E40A8", "#3B2570"]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={styles.knobFill}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: mixN }]}>
          <LinearGradient
            colors={["#F4EEFF", "#DCCEFA"]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={styles.knobFill}
          />
        </Animated.View>
      </Animated.View>

      {/* Both label colours stay mounted and cross-fade on `mixN`, so mid-drag
          each one is exactly as legible as the knob under it is opaque. Snapping
          them on the committed mode made the text flicker during a slow drag. */}
      <Pressable onPress={() => onSwitch("open")} style={styles.pillHalf}>
        <View>
          <Animated.Text style={[styles.pillLabel, styles.pillLabelAbs, { color: "#F6EFFF", opacity: Animated.subtract(1, mixN) }]}>
            OPEN
          </Animated.Text>
          <Animated.Text style={[styles.pillLabel, { color: rgba(NOID.inkRgb, 0.6), opacity: mixN }]}>
            OPEN
          </Animated.Text>
        </View>
      </Pressable>
      <Pressable onPress={() => onSwitch("noid")} style={styles.pillHalf}>
        <View>
          <Animated.Text style={[styles.pillLabel, styles.pillLabelAbs, { color: "#4E2F8E", opacity: mixN }]}>
            NOID
          </Animated.Text>
          <Animated.Text style={[styles.pillLabel, { color: rgba(OPEN.inkRgb, 0.6), opacity: Animated.subtract(1, mixN) }]}>
            NOID
          </Animated.Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/* ───────────────────────── Settings (placeholder) ───────────────────────── */
function SettingsPlaceholder({ isNoid, onLock }: { isNoid: boolean; onLock: () => void }) {
  const t = themeTokens(isNoid);
  return (
    <View>
      <UnderDevPanel
        isNoid={isNoid}
        label="Settings"
        caption="Account details, connected sites and preferences are being built."
      />
      <View style={styles.lockBay}>
        <Pressable
          onPress={onLock}
          style={({ pressed }) => [
            styles.lock,
            { backgroundColor: t.glass, borderColor: pressed ? t.down : t.glassLine },
          ]}>
          <Svg width={13} height={14} viewBox="0 0 13 14">
            <Path
              d="M1.5 6h10v7h-10z"
              stroke={rgba(t.inkRgb, 0.7)}
              strokeWidth={1.2}
              fill="none"
              strokeLinejoin="round"
            />
            <Path
              d="M3.5 6V4.5a3 3 0 116 0V6"
              stroke={rgba(t.inkRgb, 0.7)}
              strokeWidth={1.2}
              strokeLinecap="round"
              fill="none"
            />
          </Svg>
          <Text style={[styles.lockLabel, { color: rgba(t.inkRgb, 0.7) }]}>LOCK WALLET</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─── glyphs ─── */
function GearGlyph({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" opacity={0.9}>
      <Path
        fill={color}
        d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z"
      />
    </Svg>
  );
}

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12">
      <Path
        d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 14,
    zIndex: 30,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandText: { gap: 2 },
  wordmarkBay: { width: 70, height: 16 },
  walletName: {
    fontFamily: FONT.mono,
    fontSize: 8.5,
    letterSpacing: 0.5,
    maxWidth: 108,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.95 }] },

  gear: {
    height: 32,
    width: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  pill: {
    width: PILL_W,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 2,
  },
  knob: {
    position: "absolute",
    left: 2,
    top: 2,
    bottom: 2,
    width: KNOB_W,
    borderRadius: 999,
    overflow: "hidden",
  },
  knobFill: { flex: 1, borderRadius: 999 },
  pillHalf: { width: KNOB_W, alignItems: "center", justifyContent: "center" },
  pillLabel: { fontFamily: FONT.roundSemi, fontSize: 9, letterSpacing: 1.8 },
  pillLabelAbs: { position: "absolute", top: 0, left: 0, right: 0, textAlign: "center" },

  body: { flex: 1 },

  lockBay: { paddingHorizontal: 20, paddingBottom: 30 },
  lock: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  lockLabel: { fontFamily: FONT.roundSemi, fontSize: 12, letterSpacing: 2.4 },
});
