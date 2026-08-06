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
 */
import React, { memo } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import Sky from "./Sky";
import { CloudBank } from "./Clouds";

export default memo(function Backdrop({ isNoid = false }: { isNoid?: boolean }) {
  const { width, height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Sky isNoid={isNoid} width={width} height={height} />
      <CloudBank layer="mid" viewportWidth={width} style={styles.top} />
      <CloudBank layer="near" viewportWidth={width} style={styles.bottom} />
    </View>
  );
});

const styles = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0 },
  bottom: { position: "absolute", bottom: 0, left: 0 },
});
