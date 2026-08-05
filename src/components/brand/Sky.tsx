/**
 * Sky.tsx — the purple backdrop every surface opens on.
 *
 * A 225° lilac→violet diagonal (expo-linear-gradient) with an SVG radial bloom
 * top-right, a deep pool bottom-left, a printed grid, and a scatter of
 * sparkles. Fills its parent; give it a width/height (usually the window).
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, RadialGradient, Stop, Rect, Line, Path, G } from "react-native-svg";
import { SKY_OPEN, SKY_NOID } from "../../theme/tokens";

/** Printed square grid (34px cells). */
function Grid({ isNoid, width, height }: { isNoid: boolean; width: number; height: number }) {
  const cell = 34;
  const stroke = isNoid ? "rgba(198,172,255,0.09)" : "rgba(255,255,255,0.13)";
  const cols = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const lines: React.ReactNode[] = [];
  for (let i = 1; i < cols; i++)
    lines.push(<Line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={height} stroke={stroke} strokeWidth={1} />);
  for (let j = 1; j < rows; j++)
    lines.push(<Line key={`h${j}`} x1={0} y1={j * cell} x2={width} y2={j * cell} stroke={stroke} strokeWidth={1} />);
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {lines}
    </Svg>
  );
}

const SPARKS: [number, number, number, number][] = [
  [12, 14, 11, 0.9], [26, 40, 7, 0.55], [38, 9, 9, 0.7], [64, 12, 10, 0.8],
  [78, 44, 8, 0.55], [88, 20, 12, 0.9], [8, 52, 8, 0.5], [46, 60, 7, 0.4], [92, 58, 6, 0.45],
];
const SPARK_PATH = "M12 0c0 6.6 5.4 12 12 12-6.6 0-12 5.4-12 12 0-6.6-5.4-12-12-12 6.6 0 12-5.4 12-12z";

function Sparkles({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {SPARKS.map(([l, t, s, o], i) => {
        const x = (l / 100) * width;
        const y = (t / 100) * height;
        return (
          <G key={i} transform={`translate(${x} ${y}) scale(${s / 24})`} opacity={o}>
            <Path d={SPARK_PATH} fill="#fff" />
          </G>
        );
      })}
    </Svg>
  );
}

export default function Sky({
  isNoid = false,
  width,
  height,
  grid = true,
  sparkles = true,
}: {
  isNoid?: boolean;
  width: number;
  height: number;
  grid?: boolean;
  sparkles?: boolean;
}) {
  const cfg = isNoid ? SKY_NOID : SKY_OPEN;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={cfg.colors as unknown as readonly [string, string, ...string[]]}
        locations={cfg.locations as unknown as readonly [number, number, ...number[]]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="bloom" cx="100%" cy="0%" r="90%">
            <Stop offset="0" stopColor={isNoid ? "#9674E0" : "#F6E5FD"} stopOpacity={isNoid ? 0.55 : 0.92} />
            <Stop offset="0.55" stopColor={isNoid ? "#7858C4" : "#F6E5FD"} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="pool" cx="0%" cy="100%" r="90%">
            <Stop offset="0" stopColor={isNoid ? "#0C061E" : "#4E2F8E"} stopOpacity={isNoid ? 0.72 : 0.3} />
            <Stop offset="0.58" stopColor={isNoid ? "#0C061E" : "#4E2F8E"} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#bloom)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#pool)" />
      </Svg>
      {grid && <Grid isNoid={isNoid} width={width} height={height} />}
      {sparkles && !isNoid && <Sparkles width={width} height={height} />}
    </View>
  );
}
