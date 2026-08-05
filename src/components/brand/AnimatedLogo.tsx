/**
 * AnimatedLogo.tsx — the Menoid mark, alive and cheap.
 *
 * PERFORMANCE NOTE (this is the whole design):
 * The eyes are plain <View>s, not SVG. React Native's `scaleY` transform scales
 * a view about its OWN centre, which is exactly the blink we want, and — unlike
 * SVG geometry props — a transform can run on the NATIVE driver. The previous
 * version animated <Rect y/height> with useNativeDriver:false, so every frame
 * of every blink crossed into JS and re-rendered the SVG tree, on every screen,
 * forever. That was the single biggest source of the app's jank.
 *
 * Only the smile is still SVG, and it is static and memoised, so it rasterises
 * once and never re-renders.
 */
import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, Image, View, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Path } from "react-native-svg";

const blank = require("../../../assets/brand/menoid-logo-blank.png");

/* Eye geometry as fractions of the mark, converted from the artwork's 1024
   unit space (x 295.1 / 641.8, y 323.6, w 85.3, h 177.8, r 42.7). */
const EYE = {
  y: 323.6 / 1024,
  w: 85.3 / 1024,
  h: 177.8 / 1024,
  r: 42.7 / 1024,
  leftX: 295.1 / 1024,
  rightX: 641.8 / 1024,
  underlayDx: -2.7 / 1024, // the white edge peeking out on the left
};

const IRIS = ["#4d30af", "#7b5add", "#8260e4", "#7d58df"] as const;
const IRIS_STOPS = [0, 0.1, 0.3, 0.9] as const;

const Eye = memo(function Eye({
  size,
  x,
  lid,
}: {
  size: number;
  x: number;
  lid: Animated.Value;
}) {
  const w = size * EYE.w;
  const h = size * EYE.h;
  const r = size * EYE.r;
  const top = size * EYE.y;
  const box: ViewStyle = { position: "absolute", top, width: w, height: h, borderRadius: r };
  return (
    <>
      {/* white underlay, a hair to the left */}
      <Animated.View
        style={[
          box,
          {
            left: size * (x + EYE.underlayDx),
            backgroundColor: "#ffffff",
            transform: [{ scaleY: lid }],
          },
        ]}
      />
      <Animated.View
        style={[box, { left: size * x, overflow: "hidden", transform: [{ scaleY: lid }] }]}>
        <LinearGradient
          colors={IRIS as unknown as readonly [string, string, ...string[]]}
          locations={IRIS_STOPS as unknown as readonly [number, number, ...number[]]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </>
  );
});

/** The smile — static, so it is drawn once and never re-rendered. */
const Smile = memo(function Smile() {
  return (
    <Svg viewBox="0 0 1024 1024" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <SvgGradient id="al-smile" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#704bbd" />
          <Stop offset="1" stopColor="#956ff1" />
        </SvgGradient>
      </Defs>
      <Path d="M 446.2 520 Q 510.2 580.4 574.2 520" fill="none" stroke="#ffffff" strokeWidth={39.1} strokeLinecap="round" />
      <Path d="M 446.2 517.3 Q 510.2 577.8 574.2 517.3" fill="none" stroke="url(#al-smile)" strokeWidth={39.1} strokeLinecap="round" />
    </Svg>
  );
});

function AnimatedLogoBase({
  size = 120,
  style,
  blink = true,
  float = false,
}: {
  size?: number;
  style?: ViewStyle;
  blink?: boolean;
  float?: boolean;
}) {
  const lid = useRef(new Animated.Value(1)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!blink) return;
    // The website's double-blink, entirely on the UI thread.
    const t = (to: number, ms: number) =>
      Animated.timing(lid, {
        toValue: to,
        duration: ms,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      });
    const loop = Animated.loop(
      Animated.sequence([t(0.07, 90), t(1, 100), t(0.07, 90), t(1, 100), Animated.delay(2800)])
    );
    loop.start();
    return () => loop.stop();
  }, [blink, lid]);

  useEffect(() => {
    if (!float) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float, bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.05] });

  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ translateY }] }, style]}>
      <Image source={blank} style={{ width: size, height: size }} resizeMode="contain" fadeDuration={0} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Eye size={size} x={EYE.leftX} lid={lid} />
        <Eye size={size} x={EYE.rightX} lid={lid} />
        <Smile />
      </View>
    </Animated.View>
  );
}

export default memo(AnimatedLogoBase);
