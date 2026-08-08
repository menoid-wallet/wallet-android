/**
 * AccountsSheet.tsx — what the header's brand cluster opens.
 *
 * The extension's WalletSwitcher is a modal over the wallet, and it stays one
 * here rather than becoming another body tab: switching accounts is something
 * you do TO the wallet you are looking at, so it belongs on top of it, not
 * instead of it.
 *
 * The accounts are a TWO-UP GRID, not the extension's full-width rows. A phone
 * is tall and a row that wide carries one short label across 380pt of nothing;
 * two to a row makes each account a card you aim at, and puts four of them in
 * the space one list would have used — which is what keeps Add Account inside
 * the sheet instead of below the fold.
 *
 * ADD ACCOUNT GOES FULL SCREEN (see accounts/AddAccountPanel). The list is a
 * sheet because a list is short; account creation is twelve seed words, a
 * confirmation and a keyboard, and it is a different kind of moment.
 *
 * It is NOT a <Modal>. A sheet anchored to `bottom: 0` needs a parent with a
 * real height, and a Modal's content container does not reliably have one — it
 * measured zero, which put the sheet on screen at zero height (the scrim
 * appeared and nothing else did). WalletHome's root is a plain flex:1 View with
 * a definite height, so an overlay rendered as its last child sits above
 * everything and behaves the same everywhere. Back is already routed by
 * WalletHome's useBackHandler, which is the only thing Modal was giving us.
 */

import React, { memo, useEffect, useRef, useState } from "react";
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
import { useWallet } from "../context/WalletContext";
import type { WalletEntry } from "../lib/wallets";
import AddAccountPanel from "./accounts/AddAccountPanel";
import { FONT } from "../theme/tokens";
import { rgba, themeTokens } from "../theme/useThemeTokens";

/* The sheet needs an OPAQUE base: it floats above the app's backdrop, so the
   sky is not behind it and glass alone would show the dimmed screen through the
   copy. These are the two skies' flat mid tones. */
const SHEET_BASE = { open: "#C8B0EE", noid: "#2A1A52" };

const SHEET_PAD = 16;
const CARD_GAP = 10;

/** The active card is a mini treasure card — the INVERSE of the mode's sky. */
const ACTIVE_CARD = {
  open: ["#6247A8", "#3D2673", "#2B1A55"] as const,
  noid: ["#FBF7FF", "#EADFFC", "#D6C4F5"] as const,
};

function shortAddress(a?: string): string {
  if (!a) return "—";
  return a.length <= 14 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default memo(function AccountsSheet({
  open,
  onClose,
  isNoid,
}: {
  open: boolean;
  onClose: () => void;
  isNoid: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const t = themeTokens(isNoid);
  const { entries, activeIndex, switchWallet, mode } = useWallet();
  const [adding, setAdding] = useState(false);
  /* Measured rather than `flexBasis: 48%` + flexGrow. With flexGrow a row that
     is not full — one account, or the third of three — stretched its card the
     whole way across, so the same list read as boxes or as bars depending on
     how many you had. Half of the room, always. */
  const cardW = (width - CARD_GAP - SHEET_PAD * 2) / 2;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    setAdding(false);
    rise.setValue(0);
    Animated.timing(rise, {
      toValue: 1,
      duration: 380,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [open, rise]);

  if (!open) return null;

  const addressOf = (e: WalletEntry) =>
    mode === "noid" ? e.openAddress : e.openAddress ?? e.solanaAddress;

  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.scrim, { opacity: rise }]}>
        <Pressable style={styles.fill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: isNoid ? SHEET_BASE.noid : SHEET_BASE.open,
            borderColor: t.glassLine,
            /* Not jammed against the gesture bar — the Add button is the last
               thing you reach for and it should sit above the edge, not on it. */
            paddingBottom: insets.bottom + 30,
            opacity: rise,
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
          },
        ]}>
        <View style={[styles.grabber, { backgroundColor: rgba(t.inkRgb, 0.24) }]} />

        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={[styles.title, { color: t.ink }]}>Accounts</Text>
            <Text style={[styles.subtitle, { color: rgba(t.inkRgb, 0.6) }]}>
              {entries.length} {entries.length === 1 ? "account" : "accounts"} ·{" "}
              {isNoid ? "noid mode" : "open mode"}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <View style={[styles.close, { backgroundColor: t.glass, borderColor: t.glassLine }]}>
              <Svg width={11} height={11} viewBox="0 0 12 12">
                <Path
                  d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"
                  stroke={t.ink}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  fill="none"
                />
              </Svg>
            </View>
          </Pressable>
        </View>

        {/* Capped rather than free — past about half the screen the sheet stops
            being a sheet, and the grid scrolls inside instead. */}
        <ScrollView
          style={{ maxHeight: height * 0.44 }}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}>
          {entries.map((e, i) => (
            <AccountCard
              key={e.id}
              width={cardW}
              index={i}
              name={e.name}
              address={shortAddress(addressOf(e))}
              active={i === activeIndex}
              isNoid={isNoid}
              onPress={async () => {
                if (i !== activeIndex) await switchWallet(i);
                onClose();
              }}
            />
          ))}
        </ScrollView>

        <Pressable
          onPress={() => setAdding(true)}
          style={({ pressed }) => [
            styles.add,
            { borderColor: pressed ? rgba(t.inkRgb, 0.55) : rgba(t.inkRgb, 0.3) },
          ]}>
          <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
            <Path
              d="M7 1V13M1 7H13"
              stroke={rgba(t.inkRgb, 0.75)}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </Svg>
          <Text style={[styles.addText, { color: rgba(t.inkRgb, 0.8) }]}>ADD NEW ACCOUNT</Text>
        </Pressable>
      </Animated.View>

      {adding && (
        <View style={styles.full}>
          <AddAccountPanel
            isNoid={isNoid}
            onCancel={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              onClose();
            }}
          />
        </View>
      )}
    </View>
  );
});

/* ───────────────────────── one account ───────────────────────── */

const AccountCard = memo(function AccountCard({
  width,
  index,
  name,
  address,
  active,
  isNoid,
  onPress,
}: {
  width: number;
  index: number;
  name: string;
  address: string;
  active: boolean;
  isNoid: boolean;
  onPress: () => void;
}) {
  const t = themeTokens(isNoid);
  /* On the active card the content sits on the OTHER sky, so its ink flips. */
  const fg = active ? (isNoid ? "59,37,112" : "244,238,255") : t.inkRgb;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          width,
          backgroundColor: active ? "transparent" : t.glass,
          borderColor: active ? rgba(fg, 0.28) : t.glassLine,
          transform: [{ scale: pressed ? 0.975 : 1 }],
        },
      ]}>
      {active && (
        <LinearGradient
          colors={isNoid ? ACTIVE_CARD.noid : ACTIVE_CARD.open}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 19 }]}
        />
      )}

      <View style={styles.cardTop}>
        <View style={[styles.badge, { backgroundColor: rgba(fg, 0.14), borderColor: rgba(fg, 0.24) }]}>
          <Text style={[styles.badgeText, { color: rgba(fg, 0.95) }]}>{index + 1}</Text>
        </View>
        {active && <Text style={[styles.activeTag, { color: rgba(fg, 0.62) }]}>ACTIVE</Text>}
      </View>

      <Text style={[styles.cardName, { color: rgba(fg, 0.97) }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.cardAddr, { color: rgba(fg, 0.6) }]} numberOfLines={1}>
        {address}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 },
  full: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(20,9,48,0.5)",
  },
  fill: { flex: 1 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: SHEET_PAD,
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, marginBottom: 14 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  headText: { flex: 1 },
  title: { fontFamily: FONT.roundBold, fontSize: 19, letterSpacing: 0.2 },
  subtitle: { fontFamily: FONT.mono, fontSize: 10, marginTop: 3, letterSpacing: 0.4 },
  close: {
    height: 30,
    width: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Two to a row. `48%` rather than a computed width so it survives a rotation
     without measuring anything. */
  grid: { flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP, paddingBottom: 4 },
  card: {
    minHeight: 104,
    borderRadius: 20,
    borderWidth: 1,
    padding: 13,
    overflow: "hidden",
    justifyContent: "space-between",
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: {
    height: 28,
    width: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: FONT.roundBold, fontSize: 12 },
  activeTag: { fontFamily: FONT.roundSemi, fontSize: 7.5, letterSpacing: 2 },
  cardName: { fontFamily: FONT.roundBold, fontSize: 14.5, marginTop: 12 },
  cardAddr: { fontFamily: FONT.mono, fontSize: 9.5, marginTop: 3 },

  add: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingVertical: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addText: { fontFamily: FONT.roundBold, fontSize: 11, letterSpacing: 2.2 },
});
