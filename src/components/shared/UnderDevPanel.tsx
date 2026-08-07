/**
 * UnderDevPanel.tsx — the placeholder every not-yet-built corner of the wallet
 * home shows: accounts, settings, noid mode, the coin page.
 *
 * It is the same mark-on-a-cloud as the old full-screen UnderDevelopment
 * screen, shrunk to sit INSIDE WalletHome's body (no header of its own, no
 * lock button — the surface around it already has both). Themed, because these
 * placeholders are reachable from both skies.
 */

import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StillCloud } from "../brand/Clouds";
import AnimatedLogo from "../brand/AnimatedLogo";
import { FONT } from "../../theme/tokens";
import { themeTokens, rgba } from "../../theme/useThemeTokens";

export default memo(function UnderDevPanel({
  isNoid,
  label,
  caption,
  markSize = 132,
}: {
  isNoid: boolean;
  /** the section this stands in for, e.g. "Accounts" */
  label: string;
  caption: string;
  markSize?: number;
}) {
  const t = themeTokens(isNoid);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.eyebrow, { color: rgba(t.inkRgb, 0.55) }]}>{label.toUpperCase()}</Text>

      <View style={[styles.markBay, { height: markSize }]}>
        <StillCloud
          width={markSize * 1.5}
          style={{ position: "absolute", bottom: -markSize * 0.16, opacity: 0.97 }}
        />
        <AnimatedLogo size={markSize} float blink />
      </View>

      <View
        style={[
          styles.pill,
          { backgroundColor: t.glass, borderColor: t.glassLine },
        ]}>
        <View style={[styles.dot, { backgroundColor: t.accent }]} />
        <Text style={[styles.pillText, { color: t.ink }]}>Under development</Text>
      </View>

      <Text style={[styles.sub, { color: rgba(t.inkRgb, 0.66) }]}>{caption}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingHorizontal: 30, paddingTop: 22, paddingBottom: 60 },
  eyebrow: {
    alignSelf: "flex-start",
    fontFamily: FONT.roundBold,
    fontSize: 9,
    letterSpacing: 3.6,
    marginBottom: 26,
  },
  markBay: { alignItems: "center", justifyContent: "center", marginBottom: 34 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: FONT.roundBold, fontSize: 15, letterSpacing: 0.3 },
  sub: {
    marginTop: 14,
    fontFamily: FONT.body,
    fontSize: 13.5,
    textAlign: "center",
    lineHeight: 20,
  },
});
