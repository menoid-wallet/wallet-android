/**
 * CloudVoyage.tsx — the in-flight indicator shown while a transaction is
 * submitting. A small cloud drifts back and forth across a horizon.
 *
 * Ported from the extension's shared/CloudVoyage.tsx. The 2.4s period is not
 * arbitrary: AnimatedLogo's `waiting` eye-scan runs on exactly the same clock,
 * so the mark above reads as watching this cloud rather than looking around at
 * random. Change one and you must change the other.
 */

import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Ellipse, G, Rect } from "react-native-svg";
import { FONT } from "../../theme/tokens";

const PERIOD = 2400;
const CLOUD_W = 72;

export default memo(function CloudVoyage({
  tone = "light",
  label,
  width,
}: {
  tone?: "light" | "dark";
  label?: string;
  /** track width in px; the drift is computed from it */
  width: number;
}) {
  const dark = tone === "dark";
  const cloudFill = dark ? "#8E76C6" : "#F4EEFF";
  const cloudStroke = dark ? "rgba(18,9,42,0.35)" : "rgba(78,47,142,0.12)";
  const highlight = dark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.65)";
  const horizon = dark ? "rgba(244,238,255,0.12)" : "rgba(78,47,142,0.12)";
  const labelColor = dark ? "rgba(244,238,255,0.62)" : "rgba(78,47,142,0.55)";

  const drift = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const d = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: PERIOD / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: PERIOD / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    d.start();
    b.start();
    return () => {
      d.stop();
      b.stop();
    };
  }, [drift, bob]);

  const travel = Math.max(0, width - CLOUD_W - 12);

  return (
    <View style={styles.track}>
      <View style={[styles.horizon, { backgroundColor: horizon }]} />

      <Animated.View
        style={[
          styles.cloud,
          {
            transform: [
              { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [6, travel] }) },
              { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
            ],
          },
        ]}>
        <Svg viewBox="0 0 120 74" width={CLOUD_W} height={44}>
          <G fill={cloudFill} stroke={cloudStroke} strokeWidth={1}>
            <Ellipse cx={42} cy={44} rx={27} ry={21} />
            <Ellipse cx={72} cy={37} rx={31} ry={25} />
            <Ellipse cx={95} cy={47} rx={21} ry={17} />
            <Rect x={30} y={44} width={72} height={22} rx={11} />
          </G>
          <Ellipse cx={64} cy={31} rx={18} ry={9} fill={highlight} />
        </Svg>
      </Animated.View>

      {!!label && <Text style={[styles.label, { color: labelColor }]}>{label}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  track: { width: "100%", height: 82, overflow: "hidden" },
  horizon: { position: "absolute", left: 0, right: 0, bottom: 22, height: 1 },
  cloud: { position: "absolute", top: 8, left: 0, width: CLOUD_W },
  label: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 3,
    textAlign: "center",
    fontSize: 10,
    letterSpacing: 3,
    fontFamily: FONT.roundSemi,
  },
});
