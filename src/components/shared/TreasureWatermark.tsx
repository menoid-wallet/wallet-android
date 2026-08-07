/**
 * TreasureWatermark.tsx — the dim chain crest embossed into the treasure card.
 *
 * Ported from the extension's shared/TreasureWatermark.tsx.
 *
 *   - a specific chain → one big glyph, cropped off the right edge
 *   - "all"           → all six crests scattered as a faint constellation
 *
 * Each crest plays an entrance and then breathes on a slow loop. The opacity is
 * deliberately lower than a gold-on-dark watermark would need: on these violet
 * cards the crest and the card sit close in value, so anything heavier stops
 * reading as embossing and starts reading as a shape left on top of the balance.
 */

import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type DimensionValue } from "react-native";
import { CHAINS, CHAIN_BY_ID, type ChainIconProps } from "../../lib/chains";
import type { TreasureChain } from "../../context/WalletContext";

/** Scatter coordinates for the "all" constellation (right-anchored). */
const ALL_POS: { right: DimensionValue; top: DimensionValue; size: number; rot: number }[] = [
  { right: "2%", top: "6%", size: 78, rot: -8 },
  { right: "30%", top: "26%", size: 58, rot: 11 },
  { right: "-4%", top: "46%", size: 92, rot: 5 },
  { right: "24%", top: "66%", size: 54, rot: -13 },
  { right: "46%", top: "4%", size: 46, rot: 13 },
  { right: "52%", top: "54%", size: 64, rot: -5 },
];

function Crest({
  Icon,
  size,
  color,
  opacity,
  rot,
  delay,
  floatMs,
  style,
}: {
  Icon: React.FC<ChainIconProps>;
  size: number;
  color: string;
  opacity: number;
  rot: number;
  delay: number;
  floatMs: number;
  style: { right: DimensionValue; top: DimensionValue; marginTop?: number };
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: 780,
      delay,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: floatMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: floatMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    anim.start(({ finished }) => { if (finished) loop.start(); });
    return () => { anim.stop(); loop.stop(); };
  }, [enter, bob, delay, floatMs]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.crest,
        style,
        {
          width: size,
          height: size,
          opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0, opacity] }),
          transform: [
            { rotate: `${rot}deg` },
            {
              scale: Animated.multiply(
                enter.interpolate({ inputRange: [0, 1], outputRange: [1.25, 1] }),
                bob.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] })
              ),
            },
            { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
          ],
        },
      ]}>
      <Icon size={size} color={color} />
    </Animated.View>
  );
}

export default memo(function TreasureWatermark({
  treasureChain,
  isNoid,
}: {
  treasureChain: TreasureChain;
  isNoid: boolean;
}) {
  // The same colour the chain's glyph takes in the token bar for this mode.
  const color = isNoid ? "#4E2F8E" : "#E4D6FF";

  if (treasureChain === "all") {
    const op = isNoid ? 0.085 : 0.075;
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {CHAINS.map((c, i) => {
          const p = ALL_POS[i] ?? ALL_POS[0];
          return (
            <Crest
              key={c.id}
              Icon={c.Icon}
              size={p.size}
              color={color}
              opacity={op}
              rot={p.rot}
              delay={i * 70}
              floatMs={(8 + i) * 1000}
              style={{ right: p.right, top: p.top }}
            />
          );
        })}
      </View>
    );
  }

  const chain = CHAIN_BY_ID[treasureChain];
  if (!chain) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Crest
        Icon={chain.Icon}
        size={220}
        color={color}
        opacity={isNoid ? 0.1 : 0.09}
        rot={0}
        delay={0}
        floatMs={9000}
        style={{ right: -34, top: "50%", marginTop: -110 }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  crest: { position: "absolute" },
});
