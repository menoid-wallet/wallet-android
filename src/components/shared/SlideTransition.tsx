/**
 * SlideTransition.tsx — sequenced stage change.
 *
 * The stage you are leaving zooms out and is GONE before the next one moves,
 * then the next comes in from the RIGHT.
 *
 * TWO SEPARATE CAUSES OF A ONE-FRAME FLASH OF THE NEXT SCREEN AT ITS RESTING
 * POSITION — both had to be fixed, and the second is the subtle one:
 *
 *  1. RENDER ORDER. React renders the new children first and runs effects only
 *     after that frame commits, so setting the transition up in an effect
 *     painted a frame of the new screen at rest. Hence the conditional
 *     `if (routeKey !== shownKey.current)` block in the render body — React's
 *     supported derived-state escape hatch; it converges immediately.
 *
 *  2. THE NATIVE DRIVER. The animated value lives on the UI thread, so
 *     `progress.setValue(0)` is an async message to it. The entering view was
 *     mounting while the native node still held 1 from the PREVIOUS
 *     transition — which interpolates to "on screen, fully opaque". Two
 *     defences: a BRAND NEW Animated.Value(0) per transition (its native node
 *     is born at 0, so there is nothing stale to race), and `armed`, which
 *     keeps the entering layer on a plain static off-screen style until the
 *     animation has actually been started from the effect. The static style
 *     and the value-at-0 style are identical, so the handover is invisible.
 *
 * Only the OUTGOING screen is snapshotted into state. Holding the current one
 * in state as well looks harmless but is an infinite render loop, because
 * `children` is a fresh object on every render — that cost ~2× frame time
 * before it was caught.
 *
 * Everything animated is translateX / scale / opacity, so it all runs on the
 * native driver and a heavy screen cannot stutter the animation.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";

const DURATION = 460;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const OUT_END = 0.45; // the outgoing stage is fully faded by here

type Snap = { key: string; node: React.ReactNode };

export default function SlideTransition({
  routeKey,
  direction = "forward",
  children,
}: {
  /** Change this to trigger a transition. */
  routeKey: string;
  direction?: "forward" | "back";
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();

  const shownKey = useRef(routeKey);
  const shownNode = useRef<React.ReactNode>(children);
  const dirRef = useRef(direction);
  const [leaving, setLeaving] = useState<Snap | null>(null);
  /** a fresh value per transition — born at 0, so nothing stale to race */
  const [progress, setProgress] = useState(() => new Animated.Value(1));
  /** false until the animation is actually running on the native side */
  const [armed, setArmed] = useState(true);
  const toStart = useRef<Animated.Value | null>(null);

  if (routeKey !== shownKey.current) {
    const next = new Animated.Value(0);
    toStart.current = next;
    setProgress(next);
    setArmed(false);
    dirRef.current = direction;
    setLeaving({ key: shownKey.current, node: shownNode.current });
    shownKey.current = routeKey;
  }

  useEffect(() => {
    const v = toStart.current;
    if (v) {
      toStart.current = null;
      setArmed(true);
      Animated.timing(v, {
        toValue: 1,
        duration: DURATION,
        easing: EASE,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setLeaving(null);
      });
    }
    // keep the snapshot fresh without triggering a render
    shownNode.current = children;
  });

  const forward = dirRef.current === "forward";
  const from = forward ? width : -width;

  const leaveScale = progress.interpolate({
    inputRange: [0, OUT_END, 1],
    outputRange: [1, 0.82, 0.82],
  });
  const leaveFade = progress.interpolate({
    inputRange: [0, OUT_END],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const enterX = progress.interpolate({
    inputRange: [0, OUT_END, 1],
    outputRange: [from, from, 0],
  });
  const enterFade = progress.interpolate({
    inputRange: [OUT_END, OUT_END + 0.15, 1],
    outputRange: [0, 1, 1],
    extrapolate: "clamp",
  });

  // Nothing in flight: render the child plainly, with no extra layers.
  if (!leaving) return <View style={styles.fill}>{children}</View>;

  return (
    <View style={styles.fill}>
      <Animated.View
        key={leaving.key}
        pointerEvents="none"
        style={[styles.layer, { opacity: leaveFade, transform: [{ scale: leaveScale }] }]}>
        {leaving.node}
      </Animated.View>
      <Animated.View
        key={routeKey}
        style={[
          styles.layer,
          /* Until the animation is armed, hold the incoming screen off-screen
             with a PLAIN style. This is what makes the absence of the flash
             deterministic rather than dependent on when the native driver
             receives the new value. */
          armed
            ? { opacity: enterFade, transform: [{ translateX: enterX }] }
            : { opacity: 0, transform: [{ translateX: from }] },
        ]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
});
