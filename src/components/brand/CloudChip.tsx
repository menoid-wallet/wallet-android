/**
 * CloudChip.tsx — the cloud shape every pill, button and card takes.
 *
 * DRAWS ON THE FIRST FRAME. The previous version measured itself with
 * onLayout and rendered `null` until that state landed, so on every screen's
 * first paint the clouds were invisible — the label appeared instantly and the
 * cloud popped in a render later. During a 320ms screen slide that meant the
 * incoming screen was text-only for most of the transition, which read as
 * "no transition, and the buttons load late".
 *
 * So nothing here needs to know its own size:
 *   - the BODY is a plain <View> (absoluteFill + borderRadius)
 *   - the LOBES live in two SVGs pinned to the top and bottom edges with FIXED
 *     heights, positioned with percentage cx/rx (which resolve against the
 *     box's own width) and pixel cy/ry derived from `lobeBase`
 *   - the body is drawn after the lobes, so it covers where they meet it
 */
import React, { memo } from "react";
import { View, Pressable, StyleSheet, ViewStyle } from "react-native";
import Svg, { Ellipse, G } from "react-native-svg";

type Tone = "light" | "violet" | "glass" | "loading";

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
  tone === "violet"
    ? "#5E40A8"
    : tone === "glass"
      ? "rgba(255,255,255,0.30)"
      : tone === "loading"
        ? "#DCCBF7" // a violet-tinted cloud: visibly "working", still readable
        : "#F6EFFF";

const SHADOW = "rgba(64,36,122,0.16)";
const SHADOW_DY = 5;

/* A DISABLED cloud must stay OPAQUE. Fading the wrapper with `opacity` makes
   Android composite each shape separately (RN sets hasOverlappingRendering
   false), so the lobes and the body stop merging and you see the seams — the
   cloud visibly falls apart into ellipses and a rounded bar. Dimming the FILL
   keeps one solid silhouette. */
const DISABLED_FILL: Record<Tone, string> = {
  light: "#DED0F4",
  loading: "#D3C4EE",
  violet: "#7C68B4",
  glass: "rgba(255,255,255,0.16)",
};

/** The lobes along one edge. Fixed height, so it needs no measurement. */
function LobeBand({
  edge,
  base,
  over,
  fill,
  shadow,
}: {
  edge: "top" | "bottom";
  base: number;
  over: number;
  fill: string;
  shadow: boolean;
}) {
  const H = base + 6;
  const lobes = LOBES.filter((l) => l.edge === edge);

  const draw = (dy: number, colour: string) => (
    <G>
      {lobes.map((l, i) => {
        const lh = base * l.height;
        // distance of the lobe's centre from the box edge, in px
        const inset = over + 0.12 * lh;
        const cy = edge === "top" ? inset + dy : H - inset + dy;
        return (
          <Ellipse
            key={i}
            cx={`${l.left * 100}%`}
            cy={cy}
            rx={`${(l.width / 2) * 100}%`}
            ry={lh / 2}
            fill={colour}
          />
        );
      })}
    </G>
  );

  return (
    <Svg
      width="100%"
      height={H}
      pointerEvents="none"
      style={[styles.band, edge === "top" ? { top: -over } : { bottom: -over }]}>
      {shadow && draw(SHADOW_DY, SHADOW)}
      {draw(0, fill)}
    </Svg>
  );
}

export default memo(function CloudChip({
  children,
  tone = "light",
  onPress,
  disabled,
  style,
  contentStyle,
  radius,
  lobeBase = 32,
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
  const fill = disabled ? DISABLED_FILL[tone] : toneFill(tone);
  const over = lobeBase * 0.42 + 2; // how far the lobes stand proud of the box
  // 9999 makes RN clamp to a perfect pill whatever the height turns out to be
  const r = radius ?? 9999;

  const inner = (
    <View
      style={[styles.wrap, fullWidth && { alignSelf: "stretch" }, style]}>
      <LobeBand edge="top" base={lobeBase} over={over} fill={fill} shadow={shadow} />
      <LobeBand edge="bottom" base={lobeBase} over={over} fill={fill} shadow={shadow} />
      {shadow && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { top: SHADOW_DY, backgroundColor: SHADOW, borderRadius: r }]}
        />
      )}
      {/* body last of the shapes — it hides the seams where the lobes meet it */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fill, borderRadius: r }]} />
      {/* the label may fade on its own — it has nothing to overlap */}
      <View style={[styles.content, contentStyle, disabled && { opacity: 0.55 }]}>{children}</View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        /* THE TOUCH TARGET IS THE WHOLE CLOUD.
           The lobes are drawn OUTSIDE the content box, so the box alone covers
           barely more than the label — which is why the button only responded
           to taps on its text. `hitSlop` was supposed to cover that and does
           not do the job here, so the Pressable is given real PADDING the size
           of the lobe overflow (plus a margin), and an equal NEGATIVE MARGIN so
           the surrounding layout is completely unchanged. Padding is part of
           the view, so it is unambiguously touchable on every platform. */
        /* Padding is exactly the lobe overflow — no more. Overshooting it made
           neighbouring clouds' targets overlap, and a tap in the gap between
           the two doors went to whichever was drawn last. */
        style={({ pressed }) => [
          {
            paddingVertical: over,
            marginVertical: -over,
            paddingHorizontal: 8,
            marginHorizontal: -8,
          },
          fullWidth && { alignSelf: "stretch" },
          pressed && !disabled && { transform: [{ scale: 0.975 }] },
        ]}>
        {inner}
      </Pressable>
    );
  }
  return inner;
});

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start", position: "relative", justifyContent: "center" },
  band: { position: "absolute", left: 0, right: 0 },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
