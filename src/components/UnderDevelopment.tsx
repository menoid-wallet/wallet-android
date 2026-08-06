/**
 * UnderDevelopment.tsx — the unlocked home, for now.
 *
 * The living mark (blinking + bobbing) on its cloud and an "Under development"
 * badge, in the same sky. The lock button returns to the lock screen; closing
 * the app does the same on its own, since the decrypted keys are memory-only.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StillCloud } from "./brand/Clouds";
import AnimatedLogo from "./brand/AnimatedLogo";
import MenoidWordmark from "./brand/MenoidWordmark";
import CloudChip from "./brand/CloudChip";
import { COLORS, FONT } from "../theme/tokens";

export default function UnderDevelopment({ onLock }: { onLock: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const markSize = Math.min(width * 0.5, 200);

  return (
    <View style={styles.fill}>
      <View style={{ position: "absolute", top: insets.top + 14, left: 18, zIndex: 20 }}>
        <CloudChip contentStyle={styles.brandChip} lobeBase={28}>
          <MenoidWordmark height={14} tone="violet" />
        </CloudChip>
      </View>

      <Pressable
        onPress={onLock}
        hitSlop={16}
        style={{ position: "absolute", top: insets.top + 18, right: 20, zIndex: 20 }}>
        <Svg width={23} height={25} viewBox="0 0 20 22" fill="none">
          <Rect x={3} y={9} width={14} height={11} rx={2.8} stroke="#fff" strokeWidth={1.8} />
          <Path d="M6 9V6.5a4 4 0 0 1 8 0V9" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      </Pressable>

      <View style={[styles.center, { paddingBottom: insets.bottom + 110 }]}>
        <View style={{ alignItems: "center", marginBottom: 40, height: markSize }}>
          <StillCloud
            width={markSize * 1.5}
            style={{ position: "absolute", bottom: -markSize * 0.16, opacity: 0.97 }}
          />
          <AnimatedLogo size={markSize} float blink />
        </View>

        <View style={styles.pill}>
          <View style={styles.dot} />
          <Text style={styles.pillText}>Under development</Text>
        </View>
        <Text style={styles.sub}>The full private wallet is on its way.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  brandChip: { paddingHorizontal: 18, paddingVertical: 7 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.36)",
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  pillText: { fontFamily: FONT.roundBold, fontSize: 17, color: "#fff", letterSpacing: 0.3 },
  sub: {
    marginTop: 16,
    fontFamily: FONT.body,
    fontSize: 15,
    color: "rgba(255,255,255,0.76)",
    textAlign: "center",
  },
});
