/**
 * Clouds.tsx — drifting cloud banks + a single still cloud.
 *
 * react-native-svg has no goo filter, so a cloud is overlapping same-fill
 * circles (they merge into one silhouette) over a single userSpaceOnUse
 * gradient, so the vertical ramp runs continuously across the whole shape. A
 * solid deck welds the near bank's puffs to the bottom edge.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, Easing, View, StyleSheet, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Circle, Rect, G } from "react-native-svg";

type Puff = { cx: number; cy: number; r: number };

const CLOUD_SHAPES: Puff[][] = [
  [
    { cx: 58, cy: 120, r: 52 }, { cx: 126, cy: 84, r: 70 }, { cx: 212, cy: 68, r: 86 },
    { cx: 298, cy: 94, r: 64 }, { cx: 360, cy: 126, r: 46 }, { cx: 110, cy: 152, r: 54 },
    { cx: 205, cy: 154, r: 62 }, { cx: 292, cy: 150, r: 50 },
  ],
  [
    { cx: 50, cy: 132, r: 44 }, { cx: 112, cy: 96, r: 62 }, { cx: 186, cy: 82, r: 74 },
    { cx: 258, cy: 108, r: 54 }, { cx: 312, cy: 136, r: 40 }, { cx: 150, cy: 156, r: 50 },
    { cx: 232, cy: 158, r: 46 },
  ],
  [
    { cx: 64, cy: 110, r: 58 }, { cx: 146, cy: 74, r: 78 }, { cx: 236, cy: 92, r: 66 },
    { cx: 316, cy: 118, r: 52 }, { cx: 380, cy: 140, r: 38 }, { cx: 130, cy: 150, r: 56 },
    { cx: 246, cy: 152, r: 54 },
  ],
];

type CloudProps = { shape: number; x: number; y: number; scale: number };

const NEAR_CLOUDS: CloudProps[] = [
  { shape: 0, x: -120, y: 68, scale: 0.75 }, { shape: 0, x: 1280, y: 68, scale: 0.75 },
  { shape: 1, x: 130, y: 58, scale: 0.8 }, { shape: 2, x: 350, y: 64, scale: 0.72 },
  { shape: 0, x: 600, y: 55, scale: 0.78 }, { shape: 1, x: 850, y: 62, scale: 0.75 },
  { shape: 2, x: 1060, y: 58, scale: 0.7 },
];
const MID_CLOUDS: CloudProps[] = [
  { shape: 2, x: -160, y: 22, scale: 0.55 }, { shape: 2, x: 1240, y: 22, scale: 0.55 },
  { shape: 0, x: 180, y: 28, scale: 0.5 }, { shape: 1, x: 480, y: 18, scale: 0.58 },
  { shape: 2, x: 760, y: 26, scale: 0.52 }, { shape: 0, x: 1000, y: 20, scale: 0.54 },
];

/* Two sets of stops for the same silhouettes. "storm" is the same weather over
   noid mode's dark sky: the day palette on that violet reads as white paper cut
   out and pasted on, so the storm ramp bottoms out close to the sky it sits in
   and only the lit crown separates. Lifted from the extension's
   `ext-cloud-*-storm` gradients. */
const GRAD = {
  day: {
    near: [
      { o: 0, c: "#FFFFFF", op: 1 }, { o: 0.5, c: "#F4EAFF", op: 1 }, { o: 1, c: "#E3D3F8", op: 1 },
    ],
    mid: [
      { o: 0, c: "#FFFFFF", op: 0.85 }, { o: 0.5, c: "#E7D8FB", op: 0.7 }, { o: 1, c: "#CDB4F2", op: 0.55 },
    ],
  },
  storm: {
    near: [
      { o: 0, c: "#8E72CE", op: 1 }, { o: 0.5, c: "#6A4FA8", op: 1 }, { o: 1, c: "#4A3379", op: 1 },
    ],
    mid: [
      { o: 0, c: "#9C80DA", op: 0.7 }, { o: 0.5, c: "#6C51AA", op: 0.6 }, { o: 1, c: "#432E70", op: 0.5 },
    ],
  },
};

export type CloudTone = "day" | "storm";

function Puffs({ clouds, floor, gradId }: { clouds: CloudProps[]; floor: boolean; gradId: string }) {
  return (
    <>
      {floor && <Rect x={-60} y={165} width={1520} height={260} fill={`url(#${gradId})`} />}
      {clouds.map((c, i) => (
        <G key={i} transform={`translate(${c.x} ${c.y}) scale(${c.scale})`}>
          {CLOUD_SHAPES[c.shape].map((p, j) => (
            <Circle key={j} cx={p.cx} cy={p.cy} r={p.r} fill={`url(#${gradId})`} />
          ))}
        </G>
      ))}
    </>
  );
}

/**
 * A drifting cloud bank. Renders two identical strips side by side and animates
 * the pair left by one strip width, looping seamlessly.
 */
function CloudBankBase({
  layer,
  viewportWidth,
  bandHeight,
  drift = true,
  style,
  noid,
  tone = "day",
}: {
  layer: "mid" | "near";
  viewportWidth: number;
  bandHeight?: number;
  drift?: boolean;
  style?: ViewStyle;
  /** Which single tone to draw when `noid` is not supplied. */
  tone?: CloudTone;
  /**
   * 0 = day, 1 = storm. Pass an Animated.Value to cross-fade the bank with the
   * sky when the mode flips. Both tones then live INSIDE the single drifting
   * row — one drift loop, so the two silhouettes can never slide out of
   * register mid-fade, which is what happens if you stack two whole banks.
   * Omit it entirely (the setup screens do) and only the day tone is built.
   */
  noid?: Animated.Value | Animated.AnimatedInterpolation<number>;
}) {
  const stripW = viewportWidth;
  const h = bandHeight ?? stripW * (220 / 1400);
  const clouds = layer === "near" ? NEAR_CLOUDS : MID_CLOUDS;
  const floor = layer === "near";

  const tx = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!drift) return;
    const dur = layer === "near" ? 90000 : 130000;
    const loop = Animated.loop(
      Animated.timing(tx, {
        toValue: -stripW,
        duration: dur,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [stripW, drift, layer]);

  const strip = useCallback(
    (tone: CloudTone) => {
      const grad = GRAD[tone][layer];
      const gradId = `cgrad-${layer}${tone === "storm" ? "-storm" : ""}`;
      return (
        <Svg width={stripW} height={h} viewBox="0 0 1400 220">
          <Defs>
            <LinearGradient
              id={gradId}
              x1="0"
              y1="30"
              x2="0"
              y2={floor ? "170" : "220"}
              gradientUnits="userSpaceOnUse">
              {grad.map((s, i) => (
                <Stop key={i} offset={s.o} stopColor={s.c} stopOpacity={s.op} />
              ))}
            </LinearGradient>
          </Defs>
          <Puffs clouds={clouds} floor={floor} gradId={gradId} />
        </Svg>
      );
    },
    [stripW, h, floor, layer, clouds]
  );

  /* One cell of the loop. With `noid` the two tones are stacked and cross-faded
     in place; without it there is nothing to fade and the day strip is drawn
     bare, so the setup screens cost exactly what they did before.

     WHERE THE HARDWARE TEXTURE GOES MATTERS. Bare, it belongs on the drifting
     row: the whole bank bakes once and the endless drift is a texture translate
     instead of ~110 vector circles re-composited every frame. Cross-fading, it
     has to move DOWN onto each tone — a layer whose children change alpha is
     invalidated and re-rasterised every frame of the fade, whereas alpha on a
     layer-backed view is a pure GPU op. Same flag, opposite outcome. */
  const cell = useMemo(() => {
    if (!noid) return strip(tone);
    return (
      <View style={{ width: stripW, height: h }}>
        <Animated.View
          renderToHardwareTextureAndroid
          shouldRasterizeIOS
          style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, noid) }]}>
          {strip("day")}
        </Animated.View>
        <Animated.View
          renderToHardwareTextureAndroid
          shouldRasterizeIOS
          style={[StyleSheet.absoluteFill, { opacity: noid }]}>
          {strip("storm")}
        </Animated.View>
      </View>
    );
  }, [noid, tone, strip, stripW, h]);

  return (
    <View style={[{ height: h, overflow: "hidden" }, style]} pointerEvents="none">
      <Animated.View
        renderToHardwareTextureAndroid={!noid}
        shouldRasterizeIOS={!noid}
        style={{ flexDirection: "row", width: stripW * 2, transform: [{ translateX: tx }] }}>
        {cell}
        {cell}
      </Animated.View>
    </View>
  );
}

export const CloudBank = memo(CloudBankBase);

/** A single standalone cumulus — the perch the mark stands on. */
const PERCH: Puff[] = [
  { cx: 108, cy: 158, r: 58 },
  { cx: 176, cy: 128, r: 74 },
  { cx: 252, cy: 124, r: 78 },
  { cx: 322, cy: 156, r: 60 },
  { cx: 150, cy: 186, r: 58 },
  { cx: 228, cy: 190, r: 62 },
  { cx: 300, cy: 186, r: 56 },
];

function StillCloudBase({ width, style }: { width: number; style?: ViewStyle }) {
  const h = width * (264 / 420);
  return (
    /* The opacity lives on the WRAPPER, not in the gradient. With translucent
       stops every overlapping puff composites twice and you see a seam around
       each circle — which made this read as a pile of discs rather than one
       cloud. Opaque fills merge cleanly, then the whole group is faded once. */
    <View style={[{ width, height: h, opacity: 0.93 }, style]} pointerEvents="none">
      <Svg width={width} height={h} viewBox="0 0 420 264">
        <Defs>
          <LinearGradient id="scloud" x1="0" y1="60" x2="0" y2="230" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.55" stopColor="#F4EAFF" />
            <Stop offset="1" stopColor="#DFCEF9" />
          </LinearGradient>
        </Defs>
        {/* a deck welds the puffs into one flat-bottomed silhouette; it is
            inset so the end puffs always cover its corners */}
        <Rect x={110} y={150} width={200} height={78} fill="url(#scloud)" />
        {PERCH.map((p, j) => (
          <Circle key={j} cx={p.cx} cy={p.cy} r={p.r} fill="url(#scloud)" />
        ))}
      </Svg>
    </View>
  );
}

export const StillCloud = memo(StillCloudBase);
