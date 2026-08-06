/**
 * Clouds.tsx — drifting cloud banks + a single still cloud.
 *
 * react-native-svg has no goo filter, so a cloud is overlapping same-fill
 * circles (they merge into one silhouette) over a single userSpaceOnUse
 * gradient, so the vertical ramp runs continuously across the whole shape. A
 * solid deck welds the near bank's puffs to the bottom edge.
 */
import React, { memo, useEffect, useMemo, useRef } from "react";
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

const GRAD = {
  day: {
    near: [
      { o: 0, c: "#FFFFFF", op: 1 }, { o: 0.5, c: "#F4EAFF", op: 1 }, { o: 1, c: "#E3D3F8", op: 1 },
    ],
    mid: [
      { o: 0, c: "#FFFFFF", op: 0.85 }, { o: 0.5, c: "#E7D8FB", op: 0.7 }, { o: 1, c: "#CDB4F2", op: 0.55 },
    ],
  },
};

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
}: {
  layer: "mid" | "near";
  viewportWidth: number;
  bandHeight?: number;
  drift?: boolean;
  style?: ViewStyle;
}) {
  const stripW = viewportWidth;
  const h = bandHeight ?? stripW * (220 / 1400);
  const grad = GRAD.day[layer];
  const clouds = layer === "near" ? NEAR_CLOUDS : MID_CLOUDS;
  const floor = layer === "near";
  const gradId = layer === "near" ? "cgrad-near" : "cgrad-mid";

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

  const Strip = useMemo(() => (
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
  ), [stripW, h, floor, gradId, clouds, grad]);

  return (
    <View style={[{ height: h, overflow: "hidden" }, style]} pointerEvents="none">
      {/* renderToHardwareTextureAndroid: bake the two strips into ONE GPU
          texture so the endless drift is a cheap texture translate instead of
          re-compositing ~110 vector circles every frame. */}
      <Animated.View
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
        style={{ flexDirection: "row", width: stripW * 2, transform: [{ translateX: tx }] }}>
        {Strip}
        {Strip}
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
