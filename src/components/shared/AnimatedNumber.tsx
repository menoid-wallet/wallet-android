/**
 * AnimatedNumber.tsx — the odometer.
 *
 * Renders an already-formatted numeric string as a row of digit columns. When
 * the value changes each column rolls vertically from its old digit to the new
 * one; non-digits ("." "," "$") are drawn statically so the decimal point stays
 * anchored while the digits move around it.
 *
 * Ported from the extension's shared/AnimatedNumber.tsx. Two things had to
 * change for React Native:
 *
 *   - the roll is an Animated.Value on translateY (native driver) rather than a
 *     CSS transition, so it never crosses into JS mid-animation
 *   - every digit box is EXPLICITLY sized. On the web the strip inherited a
 *     line box; here `height`, `lineHeight` and (on Android)
 *     `includeFontPadding: false` are the only things keeping the 0..9 strip in
 *     register with its window. Drop any one of them and the digits sit a few
 *     pixels off and the roll stops landing cleanly.
 */

import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, TextStyle, View } from "react-native";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

interface Props {
  /** the string to show, already formatted by the caller (e.g. "$1,204.00") */
  value: string;
  /** pixel line-height of one digit */
  height?: number;
  /** font / colour / weight for the glyphs */
  textStyle?: TextStyle;
  /** roll duration in ms */
  duration?: number;
  /** digit column width as a fraction of height (lower = narrower digits) */
  widthRatio?: number;
}

function AnimatedNumberBase({
  value,
  height = 36,
  textStyle,
  duration = 600,
  widthRatio = 0.55,
}: Props) {
  const glyph: TextStyle = {
    ...textStyle,
    height,
    lineHeight: height,
    ...(Platform.OS === "android" ? { includeFontPadding: false } : null),
  };

  return (
    <View style={[styles.row, { height }]}>
      {value.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <DigitColumn
            key={`${i}-d`}
            digit={Number(ch)}
            height={height}
            duration={duration}
            width={Math.round(height * widthRatio)}
            glyph={glyph}
          />
        ) : (
          <Text key={`${i}-s`} style={glyph}>
            {ch}
          </Text>
        )
      )}
    </View>
  );
}

const DigitColumn = memo(function DigitColumn({
  digit,
  height,
  duration,
  width,
  glyph,
}: {
  digit: number;
  height: number;
  duration: number;
  width: number;
  glyph: TextStyle;
}) {
  /* Starts at 0 and rolls up to the real digit on mount — the same first-paint
     flourish the extension had, and the reason the treasure card's total spins
     into place instead of appearing. */
  const pos = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(pos, {
      toValue: digit,
      duration,
      easing: EASE,
      useNativeDriver: true,
    }).start();
  }, [digit, duration, pos]);

  const translateY = pos.interpolate({
    inputRange: [0, 9],
    outputRange: [0, -9 * height],
  });

  return (
    <View style={{ height, width, overflow: "hidden" }}>
      {/* NO renderToHardwareTextureAndroid here, and that is deliberate. It is
          tempting — the strip's content never changes, only its offset — but
          there are around forty of these columns on the dashboard at once, and
          the flag is permanent: it would leave forty standing GPU textures for
          an animation that runs for well under a second when a balance
          changes. Measured, it made the scroll WORSE. The flag belongs on a few
          big, continuously-moving surfaces (the sky, the cloud banks, the
          treasure card's orbs), not sprinkled over every small one. */}
      <Animated.View style={{ transform: [{ translateY }] }}>
        {DIGITS.map((n) => (
          <Text key={n} style={[glyph, styles.digit]}>
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  digit: { textAlign: "center" },
});

export default memo(AnimatedNumberBase);
