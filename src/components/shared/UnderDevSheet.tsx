/**
 * UnderDevSheet.tsx — a bottom sheet that says "not yet".
 *
 * Mask, Unmask and Transfer all open one of these. They are real buttons on a
 * real coin page, so tapping one has to answer rather than do nothing — but the
 * proving side is not built, and a half-working modal would be worse than an
 * honest one.
 *
 * Built on LiquidSheet so it arrives exactly like the send and receive sheets
 * do; when the real modals land they replace the contents, not the wrapper.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import AnimatedLogo from "../brand/AnimatedLogo";
import LiquidSheet from "./LiquidSheet";
import { FONT } from "../../theme/tokens";
import { rgba, themeTokens } from "../../theme/useThemeTokens";

export default function UnderDevSheet({
  open,
  onClose,
  isNoid,
  title,
  caption,
}: {
  open: boolean;
  onClose: () => void;
  isNoid: boolean;
  title: string;
  caption: string;
}) {
  const t = themeTokens(isNoid);
  return (
    <LiquidSheet open={open} onClose={onClose} tone={isNoid ? "ink" : "cream"}>
      <View style={styles.body}>
        <AnimatedLogo size={96} expression="sleeping" />
        <Text style={[styles.kicker, { color: rgba(t.inkRgb, 0.5) }]}>UNDER DEVELOPMENT</Text>
        <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
        <Text style={[styles.caption, { color: rgba(t.inkRgb, 0.62) }]}>{caption}</Text>
      </View>
    </LiquidSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: "center", paddingHorizontal: 30, paddingTop: 4, paddingBottom: 26, gap: 4 },
  kicker: { fontFamily: FONT.roundBold, fontSize: 8.5, letterSpacing: 3.6, marginTop: 10 },
  title: { fontFamily: FONT.roundBold, fontSize: 22, letterSpacing: -0.3, marginTop: 2 },
  caption: {
    fontFamily: FONT.body,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
  },
});
