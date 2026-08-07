/**
 * ComingSoonToast.tsx — the little pill that answers a button which does not do
 * anything yet (currently just "Buy").
 *
 * Ported from the extension's shared/ComingSoonToast. It rides above the coin
 * page rather than inside the scroll, so it stays put while the page moves.
 */

import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import { FONT } from "../../theme/tokens";
import { rgba, themeTokens } from "../../theme/useThemeTokens";

export default memo(function ComingSoonToast({
  show,
  onDone,
  message,
  isNoid = false,
}: {
  show: boolean;
  onDone: () => void;
  message: string;
  isNoid?: boolean;
}) {
  const t = themeTokens(isNoid);
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!show) return;
    const seq = Animated.sequence([
      Animated.spring(v, { toValue: 1, speed: 14, bounciness: 8, useNativeDriver: true }),
      Animated.delay(1900),
      Animated.timing(v, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    seq.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => seq.stop();
  }, [show, v, onDone]);

  if (!show) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        {
          backgroundColor: isNoid ? "rgba(43,26,85,0.94)" : "rgba(255,255,255,0.94)",
          borderColor: t.glassLine,
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        },
      ]}>
      <Text style={[styles.text, { color: rgba(t.inkRgb, 0.86) }]}>{message}</Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 34,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    elevation: 12,
    shadowColor: "#301A60",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  text: { fontFamily: FONT.bodySemi, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
