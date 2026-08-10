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
/** Where each drop hangs under the cloud, in px across its 72pt width. */
const RAIN_X = [12, 24, 36, 48, 60];
/** When each drop is alive within the shared 0→1 fall, staggered down the row. */
const DROP_WINDOW: number[][] = RAIN_X.map((_, i) => {
  const start = i * 0.12;
  return [start, start + 0.06, start + 0.3, start + 0.4];
});

export default memo(function CloudVoyage({
  tone = "light",
  rain = false,
  label,
  width,
}: {
  tone?: "light" | "dark";
  /** Drops falling from the cloud — the noid sheet's storm. */
  rain?: boolean;
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
  /* One value for all five drops; each reads it at its own offset, so the fall
     is staggered without five animations running. */
  const fall = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    /* ONE animation, not a there-and-back sequence.
       A looped sequence pauses at the turn twice over: `Animated.loop` tears
       the sequence down and rebuilds it between iterations, and an inOut easing
       decelerates to a full stop at each end anyway. Both read as the cloud
       sticking. Instead the driver runs 0→1 LINEARLY forever and the POSITION
       is a triangle wave read off it — so the sweep never stops, and the loop
       point sits exactly where the cloud already is. */
    const d = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: PERIOD,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: true,
      })
    );
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), isInteraction: false, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.sin), isInteraction: false, useNativeDriver: true }),
      ])
    );
    const f = Animated.loop(
      Animated.timing(fall, { toValue: 1, duration: 900, easing: Easing.linear, isInteraction: false, useNativeDriver: true })
    );
    d.start();
    b.start();
    f.start();
    return () => {
      d.stop();
      b.stop();
      f.stop();
    };
  }, [drift, bob, fall]);

  const travel = Math.max(0, width - CLOUD_W - 12);

  return (
    <View style={styles.track}>
      <View style={[styles.horizon, { backgroundColor: horizon }]} />

      <Animated.View
        style={[
          styles.cloud,
          {
            transform: [
              {
                translateX: drift.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [6, travel, 6],
                }),
              },
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

        {/* The rain falls FROM the cloud, so it lives inside the drifting
            wrapper and travels with it — as in the extension. */}
        {rain && (
          <View style={styles.rainBay} pointerEvents="none">
            {RAIN_X.map((x, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.drop,
                  {
                    left: x,
                    /* Each drop is visible for a window of the shared cycle.
                       The window must be STRICTLY increasing — an interpolation
                       whose inputRange repeats a value (which [0, 0, …] did for
                       the first drop) is rejected outright. */
                    opacity: fall.interpolate({
                      inputRange: DROP_WINDOW[i],
                      outputRange: [0, 1, 1, 0],
                      extrapolate: "clamp",
                    }),
                    transform: [
                      {
                        translateY: fall.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 18],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ))}
          </View>
        )}
      </Animated.View>

      {!!label && <Text style={[styles.label, { color: labelColor }]}>{label}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  track: { width: "100%", height: 82, overflow: "hidden" },
  horizon: { position: "absolute", left: 0, right: 0, bottom: 22, height: 1 },
  cloud: { position: "absolute", top: 8, left: 0, width: CLOUD_W },
  rainBay: { position: "absolute", top: 40, left: 0, right: 0, height: 22 },
  drop: {
    position: "absolute",
    top: 0,
    width: 2.4,
    height: 9,
    borderRadius: 2,
    backgroundColor: "#B9A6E8",
  },
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
