/**
 * CloudChip.tsx — the cloud shape every pill, button and card takes.
 *
 * Ported properly from the extension: a body (a pill for chips, a rounded card
 * for larger surfaces) with elliptical lobes bulging off the top and bottom
 * edges. Lobes are opaque and share the body's colour, so they merge into one
 * seamless silhouette; the body is drawn LAST so it covers where they meet it.
 *
 * The geometry is computed in real pixels from the measured box — NOT a fixed
 * viewBox stretched with preserveAspectRatio="none", which squashes every lobe
 * into a lumpy ellipse and is what made the first attempt look wrong.
 *
 * Lobe positions/sizes are the extension's: left/width as a fraction of the
 * box, height as a fraction of `lobeBase`, each sitting 38% of its own height
 * proud of the edge.
 */
import React, { useState } from "react";
import { View, Pressable, StyleSheet, ViewStyle, LayoutChangeEvent } from "react-native";
import Svg, { Rect, Ellipse, G, Defs, Filter, FeDropShadow } from "react-native-svg";

type Tone = "light" | "violet" | "glass";

type Lobe = { left: number; width: number; height: number; edge: "top" | "bottom" };

const LOBES: Lobe[] = [
  { left: 0.16, width: 0.34, height: 0.62, edge: "top" },
  { left: 0.45, width: 0.38, height: 0.74, edge: "top" },
  { left: 0.76, width: 0.32, height: 0.57, edge: "top" },
  { left: 0.27, width: 0.32, height: 0.57, edge: "bottom" },
  { left: 0.58, width: 0.36, height: 0.66, edge: "bottom" },
  { left: 0.86, width: 0.28, height: 0.5, edge: "bottom" },
];

const toneFill = (tone: Tone) =>
  tone === "violet" ? "#5E40A8" : tone === "glass" ? "rgba(255,255,255,0.30)" : "#F6EFFF";

/**
 * The silhouette itself, drawn to fill a measured w×h box.
 * `lobeBase` sets how big the bumps are — the box height for a pill, a fixed
 * value for a tall card (or the lobes would be absurd).
 */
export function CloudSurface({
  w,
  h,
  radius,
  tone = "light",
  lobeBase,
  shadow = true,
}: {
  w: number;
  h: number;
  radius?: number;
  tone?: Tone;
  lobeBase?: number;
  shadow?: boolean;
}) {
  if (w <= 0 || h <= 0) return null;

  const fill = toneFill(tone);
  const base = lobeBase ?? h;
  const r = radius ?? h / 2;
  const over = base * 0.42 + 2; // vertical room for the lobes to bulge into
  const pad = 14; // horizontal + shadow breathing room

  const W = w + pad * 2;
  const H = h + over * 2 + pad;

  const shapes = (
    <G>
      {LOBES.map((l, i) => {
        const lh = base * l.height;
        const lw = w * l.width;
        const cx = pad + l.left * w;
        const cy = l.edge === "top" ? over + 0.12 * lh : over + h - 0.12 * lh;
        return <Ellipse key={i} cx={cx} cy={cy} rx={lw / 2} ry={lh / 2} fill={fill} />;
      })}
      {/* body last — it covers the seams where the lobes meet it */}
      <Rect x={pad} y={over} width={w} height={h} rx={r} ry={r} fill={fill} />
    </G>
  );

  return (
    <Svg
      width={W}
      height={H}
      style={{ position: "absolute", left: -pad, top: -over }}
      pointerEvents="none">
      {shadow && (
        <Defs>
          <Filter id="cloudShadow" x="-30%" y="-30%" width="160%" height="170%">
            <FeDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#40247A" floodOpacity="0.26" />
          </Filter>
        </Defs>
      )}
      {shadow ? <G filter="url(#cloudShadow)">{shapes}</G> : shapes}
    </Svg>
  );
}

/**
 * A cloud with content inside it. Sizes itself to its children (plus padding),
 * measures, then draws the silhouette behind them.
 */
export default function CloudChip({
  children,
  tone = "light",
  onPress,
  disabled,
  style,
  contentStyle,
  radius,
  lobeBase,
  shadow = true,
  fullWidth,
}: {
  children: React.ReactNode;
  tone?: Tone;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  radius?: number;
  lobeBase?: number;
  shadow?: boolean;
  fullWidth?: boolean;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - box.w) > 0.5 || Math.abs(height - box.h) > 0.5)
      setBox({ w: width, h: height });
  };

  const inner = (
    <View
      onLayout={onLayout}
      style={[
        styles.wrap,
        fullWidth && { alignSelf: "stretch" },
        { opacity: disabled ? 0.5 : 1 },
        style,
      ]}>
      <CloudSurface w={box.w} h={box.h} radius={radius} tone={tone} lobeBase={lobeBase} shadow={shadow} />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          fullWidth && { alignSelf: "stretch" },
          pressed && !disabled && { transform: [{ scale: 0.975 }] },
        ]}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start", position: "relative", justifyContent: "center" },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
