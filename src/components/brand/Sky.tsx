/**
 * Sky.tsx — the purple backdrop every surface opens on.
 *
 * A 225° lilac→violet diagonal (expo-linear-gradient) with a radial bloom in
 * the top-right, a deep pool bottom-left, a printed grid, and a scatter of
 * sparkles.
 *
 * PERFORMANCE NOTE: this is behind EVERY screen, so it must cost nothing to
 * keep on screen.
 *   - the whole thing is memoised on (width, height, isNoid), so a parent
 *     re-render (every keystroke in a password field, say) does NOT redraw it
 *   - the grid is ONE <Path> with many subpaths instead of ~105 <Line> nodes
 *   - bloom, pool, grid and sparkles share a single <Svg> root
 */
import React, { memo, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, RadialGradient, Stop, Rect, Path, G } from "react-native-svg";
import { SKY_OPEN, SKY_NOID } from "../../theme/tokens";

const SPARKS: [number, number, number, number][] = [
  [12, 14, 11, 0.9], [26, 40, 7, 0.55], [38, 9, 9, 0.7], [64, 12, 10, 0.8],
  [78, 44, 8, 0.55], [88, 20, 12, 0.9], [8, 52, 8, 0.5], [46, 60, 7, 0.4], [92, 58, 6, 0.45],
];
const SPARK_PATH = "M12 0c0 6.6 5.4 12 12 12-6.6 0-12 5.4-12 12 0-6.6-5.4-12-12-12 6.6 0 12-5.4 12-12z";

const GRID_CELL = 34;

function SkyBase({
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

  // One path string for the entire grid — 105 nodes collapse into 1.
  const gridPath = useMemo(() => {
    if (!grid || width <= 0 || height <= 0) return "";
    let d = "";
    for (let x = GRID_CELL; x < width; x += GRID_CELL) d += `M${x} 0V${height}`;
    for (let y = GRID_CELL; y < height; y += GRID_CELL) d += `M0 ${y}H${width}`;
    return d;
  }, [grid, width, height]);

  return (
    /* renderToHardwareTextureAndroid: the sky never changes, so bake it into a
       single GPU texture. Without it, every scroll frame re-rasterises a
       full-screen gradient, two full-screen radial washes, a ~100-segment grid
       path and the sparkles. */
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      collapsable={false}>
      <LinearGradient
        colors={cfg.colors as unknown as readonly [string, string, ...string[]]}
        locations={cfg.locations as unknown as readonly [number, number, ...number[]]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="sky-bloom" cx="100%" cy="0%" r="90%">
            <Stop offset="0" stopColor={isNoid ? "#9674E0" : "#F6E5FD"} stopOpacity={isNoid ? 0.55 : 0.92} />
            <Stop offset="0.55" stopColor={isNoid ? "#7858C4" : "#F6E5FD"} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="sky-pool" cx="0%" cy="100%" r="90%">
            <Stop offset="0" stopColor={isNoid ? "#0C061E" : "#4E2F8E"} stopOpacity={isNoid ? 0.72 : 0.3} />
            <Stop offset="0.58" stopColor={isNoid ? "#0C061E" : "#4E2F8E"} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={width} height={height} fill="url(#sky-bloom)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#sky-pool)" />

        {!!gridPath && (
          <Path
            d={gridPath}
            stroke={isNoid ? "rgba(198,172,255,0.09)" : "rgba(255,255,255,0.13)"}
            strokeWidth={1}
            fill="none"
          />
        )}

        {sparkles &&
          !isNoid &&
          SPARKS.map(([l, t, s, o], i) => (
            <G
              key={i}
              transform={`translate(${(l / 100) * width} ${(t / 100) * height}) scale(${s / 24})`}
              opacity={o}>
              <Path d={SPARK_PATH} fill="#fff" />
            </G>
          ))}
      </Svg>
    </View>
  );
}

export default memo(SkyBase);
