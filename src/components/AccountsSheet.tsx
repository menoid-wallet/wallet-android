/**
 * AccountsSheet.tsx — what the header's brand cluster opens. Placeholder.
 *
 * The extension's WalletSwitcher is a modal over the wallet, and it stays one
 * here rather than becoming another body tab: switching accounts is something
 * you do TO the wallet you are looking at, so it belongs on top of it, not
 * instead of it. Multi-wallet itself is not ported yet, so for now the sheet
 * names the wallet you are in and says so.
 *
 * It is NOT a <Modal>. A sheet anchored to `bottom: 0` needs a parent with a
 * real height, and a Modal's content container does not reliably have one — it
 * measured zero, which put the sheet on screen at zero height (the scrim
 * appeared and nothing else did). WalletHome's root is a plain flex:1 View with
 * a definite height, so an overlay rendered as its last child sits above
 * everything and behaves the same everywhere. Back is already routed by
 * WalletHome's useBackHandler, which is the only thing Modal was giving us.
 */

import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import UnderDevPanel from "./shared/UnderDevPanel";
import { FONT } from "../theme/tokens";
import { rgba, themeTokens } from "../theme/useThemeTokens";

/* The sheet needs an OPAQUE base: it floats above the app's backdrop in a
   separate window, so the sky is not behind it and glass alone would show the
   dimmed screen through the copy. These are the two skies' flat mid tones —
   the same values App.tsx uses for its one-frame fallback. */
const SHEET_BASE = { open: "#C8B0EE", noid: "#2A1A52" };

export default memo(function AccountsSheet({
  open,
  onClose,
  isNoid,
  activeName,
}: {
  open: boolean;
  onClose: () => void;
  isNoid: boolean;
  activeName: string;
}) {
  const insets = useSafeAreaInsets();
  const t = themeTokens(isNoid);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    rise.setValue(0);
    Animated.timing(rise, {
      toValue: 1,
      duration: 380,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [open, rise]);

  if (!open) return null;

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
            paddingBottom: insets.bottom + 18,
            opacity: rise,
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
          },
        ]}>
        <View style={[styles.grabber, { backgroundColor: rgba(t.inkRgb, 0.24) }]} />

        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={[styles.title, { color: t.ink }]}>Accounts</Text>
            {!!activeName && (
              <Text style={[styles.subtitle, { color: rgba(t.inkRgb, 0.6) }]}>
                you're in {activeName.toLowerCase()}
              </Text>
            )}
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

        <UnderDevPanel
          isNoid={isNoid}
          label="Wallet switcher"
          caption="Adding, importing and switching between accounts is being built."
          markSize={104}
        />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 },
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
    paddingHorizontal: 4,
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, marginBottom: 14 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
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
});
