/**
 * CopyKeysButton.tsx — the cloud-shaped "Copy Keys" chip on the treasure card
 * and the popover of receiving addresses it opens.
 *
 * Ported from the copy-key popover inside the extension's OpenModeView. There
 * it was an absolutely-positioned div under the button, held open by hover.
 * Neither of those survives the move to a phone:
 *
 *   - there is no hover, so it is a tap to open and a tap outside to close
 *   - the popover CANNOT be a child of the card. It is taller than the space
 *     left below the chip, and on Android a child drawn outside its parent's
 *     bounds is clipped. So it renders in a transparent <Modal> at coordinates
 *     measured from the chip — which also gets the outside-tap dismissal for
 *     free, and guarantees it is above everything.
 */

import React, { memo, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path } from "react-native-svg";
import CloudChip from "../brand/CloudChip";
import KeyEntryRow from "./KeyEntryRow";
import { CHAIN_BY_ID } from "../../lib/chains";
import { FONT } from "../../theme/tokens";

const POPOVER_W = 236;
/** clearance for the chip's lower cloud lobes, which stand outside its box */
const LOBE_CLEARANCE = 12;

export interface ReceivingAddresses {
  evm: string;
  solana: string;
  sui: string;
  aptos: string;
}

function KeyGlyph({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 14 14">
      <Circle cx={5} cy={5} r={3} stroke={color} strokeWidth={1.4} fill="none" />
      <Path
        d="M7 7L12 12M10.5 12.5L12 11M9 11L10.5 9.5"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function Chevron({ color, up }: { color: string; up: boolean }) {
  return (
    <Svg width={8} height={8} viewBox="0 0 10 10" style={up ? { transform: [{ rotate: "180deg" }] } : undefined}>
      <Path
        d="M1.5 3.5L5 7L8.5 3.5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export default memo(function CopyKeysButton({
  addresses,
  isNoid,
}: {
  addresses: ReceivingAddresses;
  isNoid: boolean;
}) {
  const { width: screenW } = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const pop = useRef(new Animated.Value(0)).current;

  // On the DARK open card the chip is a pale cloud; on the PALE noid card it is
  // a violet one — the chip is always the opposite of the card, like the card is
  // always the opposite of the sky.
  const chipTone = isNoid ? "violet" : "light";
  const chipInk = isNoid ? "#F6EFFF" : "#3B2570";

  const open = () => {
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      const left = Math.min(Math.max(x, 12), Math.max(12, screenW - POPOVER_W - 12));
      setAnchor({ x: left, y: y + h + LOBE_CLEARANCE });
      pop.setValue(0);
      Animated.timing(pop, {
        toValue: 1,
        duration: 260,
        easing: Easing.bezier(0.34, 1.4, 0.5, 1),
        useNativeDriver: true,
      }).start();
    });
  };

  return (
    <>
      <View ref={anchorRef} collapsable={false} style={styles.anchor}>
        <CloudChip
          tone={chipTone}
          onPress={open}
          lobeBase={22}
          contentStyle={styles.chipContent}>
          <KeyGlyph color={chipInk} />
          <Text style={[styles.chipLabel, { color: chipInk }]}>Copy Keys</Text>
          <Chevron color={chipInk} up={anchor != null} />
        </CloudChip>
      </View>

      <Modal
        visible={anchor != null}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setAnchor(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAnchor(null)} />
        {anchor && (
          <Animated.View
            style={[
              styles.popover,
              {
                left: anchor.x,
                top: anchor.y,
                opacity: pop,
                transform: [
                  { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
                  { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ],
              },
            ]}>
            <LinearGradient
              colors={["#4A3080", "#26154C"]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.popoverTitle}>RECEIVING ADDRESSES</Text>
            <KeyEntryRow Icon={CHAIN_BY_ID.sepolia.Icon} value={addresses.evm} />
            <KeyEntryRow Icon={CHAIN_BY_ID.solana.Icon} value={addresses.solana} />
            <KeyEntryRow Icon={CHAIN_BY_ID.sui.Icon} value={addresses.sui} />
            <KeyEntryRow Icon={CHAIN_BY_ID.aptos.Icon} value={addresses.aptos} />
          </Animated.View>
        )}
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  anchor: { alignSelf: "flex-start" },
  chipContent: { paddingHorizontal: 16, paddingVertical: 6, gap: 6 },
  chipLabel: {
    fontFamily: FONT.roundSemi,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  popover: {
    position: "absolute",
    width: POPOVER_W,
    borderRadius: 16,
    borderTopLeftRadius: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    padding: 10,
    elevation: 18,
    shadowColor: "#140930",
    shadowOpacity: 0.6,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  popoverTitle: {
    fontFamily: FONT.roundSemi,
    fontSize: 8,
    letterSpacing: 2.4,
    color: "rgba(255,255,255,0.55)",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
});
