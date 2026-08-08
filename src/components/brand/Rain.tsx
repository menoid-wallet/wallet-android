/**
 * Rain.tsx — noid mode's weather.
 *
 * Ported from the extension's components/brand/Rain.tsx, which was itself the
 * website's rain scaled down. Two layers is what sells the depth: `far` sits
 * behind the content, thin and slow; `near` sits in front of everything,
 * brighter and fewer, so a handful of drops pass between the user and the UI.
 *
 * DROPS ARE SEEDED, NOT RANDOM. Every mode switch could remount this, and a
 * reshuffled field reads as a glitch rather than as rain. A fixed seed means
 * the storm is the same storm each time.
 *
 * Each drop is ONE Animated.Value looping a translateY on the native driver,
 * started once and never touched again. The web version could hand a single CSS
 * keyframe to every drop; here each needs its own value, which is the reason
 * the counts are conservative — 34 far and 11 near is 45 native animations, and
 * that is already the ceiling of what should be running behind a scroll.
 */

import React, { memo, useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/** mulberry32 — small, fast, deterministic. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Drop = {
  left: number; // %
  top: number; // %
  len: number;
  width: number;
  opacity: number;
  duration: number;
  delay: number;
};

function makeDrops(count: number, seed: number, near: boolean): Drop[] {
  const rnd = seeded(seed);
  return Array.from({ length: count }, () => {
    const speed = rnd();
    return {
      left: rnd() * 100,
      top: rnd() * 100,
      len: near ? 20 + speed * 30 : 11 + speed * 20,
      width: near ? 1.5 : 1,
      opacity: near ? 0.22 + speed * 0.26 : 0.1 + speed * 0.2,
      duration: (near ? 0.62 + (1 - speed) * 0.5 : 0.95 + (1 - speed) * 0.9) * 1000,
      // Staggered starts, so the field is mid-flight rather than falling in
      // formation the first second after a mode switch.
      delay: rnd() * 2400,
    };
  });
}

const FAR = makeDrops(34, 20260721, false);
const NEAR = makeDrops(11, 987654321, true);

/** How far a drop falls before it is recycled, as a fraction of the surface. */
const FALL = 0.34;

const RainDrop = memo(function RainDrop({ drop, height }: { drop: Drop; height: number }) {
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(y, {
        toValue: 1,
        duration: drop.duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const kick = setTimeout(() => loop.start(), drop.delay);
    return () => {
      clearTimeout(kick);
      loop.stop();
    };
  }, [y, drop.duration, drop.delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: `${drop.left}%`,
        top: `${drop.top}%`,
        width: drop.width,
        height: drop.len,
        borderRadius: drop.width,
        backgroundColor: "#DCCEFA",
        // Fade in at the top of the fall and out at the bottom, or every drop
        // pops out of nothing and vanishes into nothing at a hard edge.
        opacity: y.interpolate({
          inputRange: [0, 0.15, 0.8, 1],
          outputRange: [0, drop.opacity, drop.opacity, 0],
        }),
        transform: [
          { translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, height * FALL] }) },
        ],
      }}
    />
  );
});

function Layer({ drops, height, style }: { drops: Drop[]; height: number; style?: any }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, style]}>
      {drops.map((d, i) => (
        <RainDrop key={i} drop={d} height={height} />
      ))}
    </View>
  );
}

/** The back curtain — goes with the sky, under the content. */
export const RainFar = memo(function RainFar({ height }: { height: number }) {
  const drops = useMemo(() => FAR, []);
  return <Layer drops={drops} height={height} />;
});

/** The front curtain — over everything, and deliberately few. */
export const RainNear = memo(function RainNear({ height }: { height: number }) {
  const drops = useMemo(() => NEAR, []);
  return <Layer drops={drops} height={height} style={styles.near} />;
});

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  near: { opacity: 0.85 },
});
