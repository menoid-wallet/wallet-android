/**
 * RefreshDim — the "this figure is being reloaded" look.
 *
 * Wraps whatever shows a number and breathes it down to a dim state while a
 * refresh is in flight, back to full when it lands. A spinner over the figure
 * would hide the very thing you pressed refresh to see; dimming keeps the old
 * value readable and still says clearly that it is stale.
 *
 * Native-driven and opacity-only, so it costs nothing on the JS thread even
 * while six chains are being refetched behind it.
 */

import React, { useEffect, useRef } from "react";
import { Animated, Easing, type ViewStyle } from "react-native";
import type { Scope } from "../../lib/refreshBus";
import { useRefreshBusy } from "../../lib/useRefresh";

export default function RefreshDim({
  scope,
  children,
  style,
}: {
  /** Only dims for a manual refresh of this half of the wallet. */
  scope: Scope;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const busy = useRefreshBusy(scope);
  const dim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!busy) {
      Animated.timing(dim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }
    /* A single linear driver with a triangle interpolation, not a sequence:
       sequences pause at their turning points and the pulse reads as a stutter.
       Same reasoning as the loading cloud in MaskModal. */
    dim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(dim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [busy, dim]);

  const opacity = busy
    ? dim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.32, 0.7, 0.32] })
    : dim;

  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
