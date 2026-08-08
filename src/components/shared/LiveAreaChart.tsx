/**
 * LiveAreaChart.tsx — the price curve on the coin page's graph card.
 *
 * Ported from the extension's shared/LiveAreaChart.tsx: a Catmull-Rom spline
 * turned into cubic béziers, a gradient area fill, and a head marker pulsing on
 * the latest point.
 *
 * THE ARRIVAL IS A TRANSFORM, NOT A DASH ANIMATION. The web version animated
 * `stroke-dashoffset` to draw the line on. Nothing in react-native-svg can put
 * that on the native driver, so it would mean re-rendering the whole SVG tree
 * from JS every frame — on the one screen that is also polling six chains'
 * balances. A left-anchored clip wipe is possible with nested counter-scales,
 * but it needs a child scaled by 1/progress, which at the start of the
 * animation is a several-thousand-times oversized layer for the GPU to
 * allocate. Neither is worth it.
 *
 * So the finished curve rises and fades in as ONE composited layer, and the
 * head marker pops once it has landed. Two animated nodes, both native, no
 * per-frame JS at all.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import { FONT } from "../../theme/tokens";

const PAD_X = 6;
const PAD_Y = 14;

let uid = 0;

type Pt = { x: number; y: number };

function buildPaths(points: number[], width: number, height: number) {
  if (points.length < 2 || width <= 0) {
    return { line: "", area: "", last: null as null | Pt, coords: [] as Pt[] };
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((v, i) => ({
    x: PAD_X + (i / (points.length - 1)) * (width - 2 * PAD_X),
    y: height - PAD_Y - ((v - min) / range) * (height - 2 * PAD_Y),
  }));

  const t = 0.16;
  let line = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    line += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  const last = coords[coords.length - 1];
  const area = `${line} L ${last.x.toFixed(2)} ${height} L ${coords[0].x.toFixed(2)} ${height} Z`;
  return { line, area, last, coords };
}

export default memo(function LiveAreaChart({
  points,
  width,
  lineColor,
  areaColor,
  height = 128,
  loading = false,
  emptyColor = "rgba(255,255,255,0.4)",
  onScrub,
}: {
  points: number[];
  width: number;
  /** stroke colour for the line + head marker */
  lineColor: string;
  /** rgb() used for the area gradient tint (usually the chain brand) */
  areaColor: string;
  height?: number;
  loading?: boolean;
  emptyColor?: string;
  /** Which point the read-head is over, or null once it has sprung home. */
  onScrub?: (index: number | null) => void;
}) {
  const ids = useMemo(() => {
    const n = uid++;
    return { grad: `chart-grad-${n}`, clip: `chart-clip-${n}` };
  }, []);

  const { line, area, last, coords } = useMemo(
    () => buildPaths(points, width, height),
    [points, width, height]
  );

  const reveal = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  /* ── The scrubber ──
     A read-head that rests on the newest point and can be dragged back through
     the series; letting go springs it home. Both ends of that are native
     transforms, so the line itself never costs a render — only the price
     readout does, and that is reported at most once per POINT crossed rather
     than once per touch event.

     It is a gesture-handler pan, and it has to be: the coin page sits inside a
     horizontal pager (drag right = back to the list) and a plain PanResponder
     would lose every horizontal drag to Android's native scroll interception.
     gesture-handler wins that fight. What it must NOT be given is an
     `Animated.event` with the native driver — that combination is a hard crash
     on the New Architecture. A plain callback plus `setValue` keeps the graph
     native without going near it. */
  const rest = Math.max(0, points.length - 1);
  const scrubX = useRef(new Animated.Value(0)).current;
  const scrubY = useRef(new Animated.Value(0)).current;
  const heldAt = useRef(rest);
  const [scrubbing, setScrubbing] = useState(false);

  const place = useCallback(
    (i: number, animate = false) => {
      const c = coords[i];
      if (!c) return;
      if (animate) {
        Animated.parallel([
          Animated.spring(scrubX, { toValue: c.x, speed: 16, bounciness: 0, useNativeDriver: true }),
          Animated.spring(scrubY, { toValue: c.y, speed: 16, bounciness: 0, useNativeDriver: true }),
        ]).start();
      } else {
        scrubX.setValue(c.x);
        scrubY.setValue(c.y);
      }
    },
    [coords, scrubX, scrubY]
  );

  // A new range redraws the curve, so the head has to be re-seated on it.
  useEffect(() => {
    heldAt.current = rest;
    place(rest);
  }, [rest, place]);

  const indexAt = useCallback(
    (x: number) => {
      const span = width - 2 * PAD_X;
      if (span <= 0 || coords.length < 2) return 0;
      const f = (x - PAD_X) / span;
      return Math.max(0, Math.min(coords.length - 1, Math.round(f * (coords.length - 1))));
    },
    [width, coords.length]
  );

  const moveTo = useCallback(
    (x: number) => {
      const i = indexAt(x);
      if (i === heldAt.current) return;
      heldAt.current = i;
      place(i);
      onScrub?.(i);
    },
    [indexAt, place, onScrub]
  );

  const onPan = useCallback(
    (e: PanGestureHandlerGestureEvent) => moveTo(e.nativeEvent.x),
    [moveTo]
  );

  const onPanState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, x } = e.nativeEvent;
      if (state === State.ACTIVE) {
        setScrubbing(true);
        heldAt.current = -1; // force the first report
        moveTo(x);
        return;
      }
      if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
        setScrubbing(false);
        heldAt.current = rest;
        place(rest, true);
        onScrub?.(null);
      }
    },
    [moveTo, place, rest, onScrub]
  );

  // Re-run the wipe whenever the curve itself changes (a range switch).
  useEffect(() => {
    if (!line) return;
    reveal.setValue(0);
    const a = Animated.timing(reveal, {
      toValue: 1,
      duration: 1000,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [line, reveal]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(1000),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (!loading && points.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={[styles.emptyText, { color: emptyColor }]}>CHART UNAVAILABLE</Text>
      </View>
    );
  }

  if (points.length < 2 || !line) {
    return <View style={{ height }} />;
  }

  const areaFill = areaColor.replace("rgb", "rgba").replace(")", ",1)");

  return (
    <View style={{ width, height }}>
      <Animated.View
        style={{
          opacity: reveal.interpolate({ inputRange: [0, 0.45], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
          ],
        }}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={ids.grad} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={areaFill} stopOpacity={0.28} />
              <Stop offset="0.55" stopColor={areaFill} stopOpacity={0.08} />
              <Stop offset="1" stopColor={areaFill} stopOpacity={0} />
            </LinearGradient>
          </Defs>

          <Path d={area} fill={`url(#${ids.grad})`} />
          <Path
            d={line}
            fill="none"
            stroke={lineColor}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>

      {last && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.head,
            {
              left: last.x - 7,
              top: last.y - 7,
              // The read-head takes over the marker's job while it is out.
              opacity: Animated.multiply(
                reveal.interpolate({ inputRange: [0, 0.92, 1], outputRange: [0, 0, 1] }),
                scrubbing ? 0 : 1
              ),
            },
          ]}>
          <Animated.View
            style={[
              styles.halo,
              {
                backgroundColor: areaFill,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
              },
            ]}
          />
          <View style={[styles.dot, { backgroundColor: lineColor }]} />
        </Animated.View>
      )}

      {/* ── read-head ── */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.readLine,
          {
            height,
            backgroundColor: lineColor,
            opacity: reveal.interpolate({
              inputRange: [0, 0.92, 1],
              outputRange: [0, 0, scrubbing ? 0.55 : 0.28],
            }),
            transform: [{ translateX: scrubX }],
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.readDot,
          {
            borderColor: lineColor,
            opacity: reveal.interpolate({ inputRange: [0, 0.92, 1], outputRange: [0, 0, 1] }),
            transform: [
              { translateX: scrubX },
              { translateY: scrubY },
              { scale: scrubbing ? 1 : 0.72 },
            ],
          },
        ]}
      />

      {/* The touch surface, over everything and taller than the curve so the
          head is reachable without having to land on the line itself. */}
      <PanGestureHandler
        onGestureEvent={onPan}
        onHandlerStateChange={onPanState}
        activeOffsetX={[-6, 6]}
        failOffsetY={[-14, 14]}>
        <View style={StyleSheet.absoluteFill} />
      </PanGestureHandler>
    </View>
  );
});

const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 10, letterSpacing: 3, fontFamily: FONT.body },
  head: { position: "absolute", width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  /* Both are anchored at 0,0 and driven entirely by transform, so the animated
     values are plain point coordinates and nothing has to be re-laid-out. */
  readLine: { position: "absolute", top: 0, left: -0.9, width: 1.8, borderRadius: 1 },
  readDot: {
    position: "absolute",
    top: -6,
    left: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.4,
    backgroundColor: "#ffffff",
  },
  halo: { position: "absolute", width: 14, height: 14, borderRadius: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
