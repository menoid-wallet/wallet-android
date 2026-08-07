/**
 * Backdrop.tsx — the weather, mounted ONCE for the whole app.
 *
 * Every screen used to render its own <Sky> and its own <CloudBank>. Two
 * consequences, both of which the user felt:
 *
 *   1. the cloud drift restarted from zero on every screen change, so the banks
 *      visibly jumped back and stuttered whenever you moved between stages
 *   2. during a transition BOTH screens existed, so the app was rasterising two
 *      full-screen gradients, two grids and four cloud banks at the exact
 *      moment it needed the frames for the animation
 *
 * Mounted once here, behind everything, the drift is continuous for the life of
 * the app and a screen change costs nothing but the screen's own content.
 * Screens must therefore be transparent and draw no sky of their own.
 *
 * THE MODE SWITCH IS THE WEATHER CHANGING, so it happens here rather than in
 * WalletHome: open and noid are the same sky at two times of day, and the
 * cross-fade has to run underneath every screen at once for that to read. The
 * noid half is built lazily (`enableNoid`) — the onboarding and lock screens
 * can never show it, and paying for a second full-screen gradient before the
 * splash lifts is exactly the cost App.tsx works so hard to avoid.
 */
import React, { memo, useEffect, useState } from "react";
import { Animated, StyleSheet, useWindowDimensions, View } from "react-native";
import Sky from "./Sky";
import { CloudBank } from "./Clouds";
import { modeMix } from "../../lib/modeMotion";

export default memo(function Backdrop({
  isNoid = false,
  enableNoid = false,
}: {
  isNoid?: boolean;
  /** Build the noid sky + storm clouds. Set once the wallet is unlocked. */
  enableNoid?: boolean;
}) {
  const { width, height } = useWindowDimensions();

  /* The weather is driven from lib/modeMotion, not from a local value: the same
     node is moved by the pill AND by the swipe, so dragging the page sideways
     literally pulls the storm across the sky under your thumb. `isNoid` is only
     read here to decide whether the noid layers need to exist at all. */
  const noid = modeMix;

  /* Latched, never un-latched. Locking the wallet drops both flags at once, and
     tearing the noid layers out on that same frame would make the storm POP off
     instead of fading — the cross-fade still has its full duration to run. Once
     the app has paid for them there is no reason to give them back. */
  const [on, setOn] = useState(enableNoid || isNoid);
  useEffect(() => {
    if (enableNoid || isNoid) setOn(true);
  }, [enableNoid, isNoid]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Both skies stay mounted and cross-fade, so what the eye sees when the
          mode flips is the light changing rather than one surface being swapped
          for another. Each is memoised on (width, height, isNoid), so neither
          redraws when the other's opacity moves. */}
      <Sky isNoid={false} width={width} height={height} />
      {on && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: noid }]}>
          <Sky isNoid width={width} height={height} />
        </Animated.View>
      )}
      <CloudBank layer="mid" viewportWidth={width} style={styles.top} noid={on ? noid : undefined} />
      <CloudBank layer="near" viewportWidth={width} style={styles.bottom} noid={on ? noid : undefined} />
    </View>
  );
});

const styles = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0 },
  bottom: { position: "absolute", bottom: 0, left: 0 },
});
