/**
 * TreasureCardShell.tsx — the treasure card's BACKGROUND: the deep violet slab
 * and everything drifting inside it.
 *
 * Ported from the decoration layer of the extension's OpenModeView treasure
 * card. The inversion is the point: whichever mode you are in, the treasure is
 * the opposite of the weather around it, so it reads as the one solid object on
 * a page made of sky. The drifting puffs are what make it a piece of weather
 * rather than a rectangle.
 *
 * WHAT THE WEB DID THAT RN CANNOT, and what stands in for it:
 *
 *   blur(38px) on the orbs → there is no filter primitive here, so the orbs are
 *     radial gradients with a deliberately LONG, multi-stop falloff. A blurred
 *     hard-edged radial and a soft-edged one are the same picture; only the
 *     recipe differs.
 *   the 115° sheen sweep → an expo-linear-gradient band translated across the
 *     card on the native driver, which is what the CSS keyframe compiled to
 *     anyway.
 *   backgroundImage grid → one <Path> of subpaths, the same trick Sky.tsx uses.
 *
 * Everything animated here runs on the native driver, because this sits under a
 * scrolling list and must never ask the JS thread for a frame.
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, LayoutChangeEvent, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { CloudBank } from "../brand/Clouds";
import TreasureWatermark from "./TreasureWatermark";
import type { TreasureChain } from "../../context/WalletContext";

export const CARD_RADIUS = 32;
const GRID_CELL = 28;

/** The card body. Noid is the same card with the two ends of the palette swapped. */
const BODY = {
  open: { colors: ["#6247A8", "#3D2673", "#2B1A55"] as const, grid: "rgba(244,238,255,0.05)" },
  noid: { colors: ["#F4EEFF", "#DCCEFA", "#B79BF0"] as const, grid: "rgba(43,26,85,0.05)" },
};

/** A soft radial bloom. Long falloff instead of a Gaussian blur — see header. */
function Orb({
  id,
  size,
  rgb,
  alpha,
}: {
  id: string;
  size: number;
  rgb: string;
  alpha: number;
}) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={rgb} stopOpacity={alpha} />
          <Stop offset="0.34" stopColor={rgb} stopOpacity={alpha * 0.72} />
          <Stop offset="0.62" stopColor={rgb} stopOpacity={alpha * 0.3} />
          <Stop offset="0.84" stopColor={rgb} stopOpacity={alpha * 0.08} />
          <Stop offset="1" stopColor={rgb} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  );
}

/** One orb's 10–12s wander. `phase` staggers the second one. */
function useDrift(toX: number, toY: number, toScale: number, toOpacity: number, ms: number, delay: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const t = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(t); loop.stop(); };
  }, [v, ms, delay]);

  return {
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, toOpacity] }),
    transform: [
      { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, toX] }) },
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, toY] }) },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, toScale] }) },
    ],
  };
}

export default memo(function TreasureCardShell({
  isNoid,
  treasureChain,
}: {
  isNoid: boolean;
  treasureChain: TreasureChain;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  const body = isNoid ? BODY.noid : BODY.open;

  const orb1 = useDrift(-30, 20, 1.15, 0.7, 12000, 0);
  const orb2 = useDrift(40, -30, 1.2, 0.6, 10000, 2000);

  // The sheen's travel, ±30% of the card's width — the CSS keyframe, natively.
  const sheen = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sheen, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sheen, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sheen]);

  const gridPath = React.useMemo(() => {
    if (size.w <= 0 || size.h <= 0) return "";
    let d = "";
    for (let x = GRID_CELL; x < size.w; x += GRID_CELL) d += `M${x} 0V${size.h}`;
    for (let y = GRID_CELL; y < size.h; y += GRID_CELL) d += `M0 ${y}H${size.w}`;
    return d;
  }, [size.w, size.h]);

  return (
    <View style={styles.shell} onLayout={onLayout} pointerEvents="none">
      <LinearGradient
        colors={body.colors as unknown as readonly [string, string, ...string[]]}
        locations={[0, 0.58, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {size.w > 0 && (
        <>
          {/* Every drifting decoration is its own baked texture. They are all
              static art moved by a transform, so a layer each turns ~4 gradient
              re-rasters per frame into 4 matrix updates. */}
          <Animated.View
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
            style={[
              { position: "absolute", top: -0.34 * size.h, right: -0.12 * size.w },
              orb1,
            ]}>
            <Orb id="treasure-orb-1" size={260} rgb={isNoid ? "#7B55C9" : "#D6C0FA"} alpha={0.55} />
          </Animated.View>

          <Animated.View
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
            style={[
              { position: "absolute", bottom: -0.24 * size.h, left: -0.16 * size.w },
              orb2,
            ]}>
            <Orb id="treasure-orb-2" size={220} rgb={isNoid ? "#5E40A8" : "#9F7DF9"} alpha={0.42} />
          </Animated.View>

          <Animated.View
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
            style={[
              StyleSheet.absoluteFill,
              { opacity: 0.45, transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-0.3 * size.w, 0.3 * size.w] }) }] },
            ]}>
            <LinearGradient
              colors={["transparent", isNoid ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.1)", "transparent"]}
              locations={[0.3, 0.5, 0.7]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {!!gridPath && (
            <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
              <Path d={gridPath} stroke={body.grid} strokeWidth={1} fill="none" />
            </Svg>
          )}

          <TreasureWatermark treasureChain={treasureChain} isNoid={isNoid} />

          {/* a low cloud bank along the card's OWN bottom edge — storm-toned in
              both modes, because it sits on the card, not on the sky */}
          <View style={styles.cardFloor}>
            <CloudBank
              layer="near"
              viewportWidth={size.w}
              bandHeight={74}
              tone={isNoid ? "day" : "storm"}
            />
          </View>
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  shell: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
  },
  cardFloor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 74,
    overflow: "hidden",
    opacity: 0.6,
  },
});
