/**
 * AnimatedLogo.tsx — the Menoid mark, alive.
 *
 * The flat faceless body (menoid-logo-blank.png) with the eyes + smile drawn
 * over it in SVG, in the extension's 1024-unit geometry.
 *
 * THE BLINK: the lid is animated as the eye rect's own GEOMETRY — height
 * shrinks while y grows by half as much, so the centre stays exactly put:
 *
 *     height = h · s          y = cy − (h · s)/2
 *
 * It is NOT a scaleY on a wrapping <G>. react-native-svg does not honour a
 * CSS-style `transform-origin: center` there, so the group scales about the
 * SVG origin instead and the eyes visibly launch off the top of the face —
 * which is exactly the bug that shipped the first time.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Image, View, StyleSheet, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect, Path } from "react-native-svg";

const blank = require("../../../assets/brand/menoid-logo-blank.png");

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Eye sockets in the artwork's 1024-unit space.
const EYE_L = { x: 295.1, y: 323.6, w: 85.3, h: 177.8 };
const EYE_R = { x: 641.8, y: 323.6, w: 85.3, h: 177.8 };
const EYE_RADIUS = 42.7;
const SHUT = 0.07; // how nearly-closed a full blink gets

function Eye({ e, lid }: { e: typeof EYE_L; lid: Animated.Value }) {
  const cy = e.y + e.h / 2;
  // lid: 1 = wide open, 0 = shut. Both props stay linear in it.
  const height = lid.interpolate({ inputRange: [0, 1], outputRange: [e.h * SHUT, e.h] });
  const y = lid.interpolate({
    inputRange: [0, 1],
    outputRange: [cy - (e.h * SHUT) / 2, cy - e.h / 2],
  });
  return (
    <>
      {/* white underlay, a hair to the left, then the violet iris */}
      <AnimatedRect x={e.x - 2.7} y={y} width={e.w} height={height} rx={EYE_RADIUS} ry={EYE_RADIUS} fill="#ffffff" />
      <AnimatedRect x={e.x} y={y} width={e.w} height={height} rx={EYE_RADIUS} ry={EYE_RADIUS} fill="url(#al-eye)" />
    </>
  );
}

export default function AnimatedLogo({
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
    // The website's double-blink: shut-open-shut-open, then a long rest.
    const t = (to: number, ms: number) =>
      Animated.timing(lid, {
        toValue: to,
        duration: ms,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false, // SVG geometry props can't use the native driver
      });
    const loop = Animated.loop(
      Animated.sequence([t(0, 90), t(1, 100), t(0, 90), t(1, 100), Animated.delay(2800)])
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
      <Image source={blank} style={{ width: size, height: size }} resizeMode="contain" />
      <Svg viewBox="0 0 1024 1024" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="al-eye" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#4d30af" />
            <Stop offset="0.1" stopColor="#7b5add" />
            <Stop offset="0.3" stopColor="#8260e4" />
            <Stop offset="0.9" stopColor="#7d58df" />
          </LinearGradient>
          <LinearGradient id="al-smile" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#704bbd" />
            <Stop offset="1" stopColor="#956ff1" />
          </LinearGradient>
        </Defs>

        <Eye e={EYE_L} lid={lid} />
        <Eye e={EYE_R} lid={lid} />

        <Path d="M 446.2 520 Q 510.2 580.4 574.2 520" fill="none" stroke="#ffffff" strokeWidth={39.1} strokeLinecap="round" />
        <Path d="M 446.2 517.3 Q 510.2 577.8 574.2 517.3" fill="none" stroke="url(#al-smile)" strokeWidth={39.1} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}
