/**
 * InlineCopyButton.tsx — the tiny copy chip that lives inside another tappable
 * row (a token bar).
 *
 * Ported from the extension's shared/InlineCopyButton.tsx. The web version had
 * to call stopPropagation() so copying never also opened the coin page; RN's
 * responder system hands the touch to the innermost Pressable on its own, so
 * the guard is the nested Pressable itself.
 *
 * `fg` is the foreground as an "r,g,b" triple — ink on the light page, bone on
 * the dark one.
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import * as Clipboard from "expo-clipboard";

export default memo(function InlineCopyButton({ value, fg }: { value: string; fg: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = () => {
    if (!value) return;
    void Clipboard.setStringAsync(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };

  const tint = copied ? "#7B55C9" : `rgba(${fg},0.5)`;

  return (
    <Pressable onPress={copy} hitSlop={8} accessibilityLabel="Copy address">
      <View
        style={[
          styles.chip,
          {
            backgroundColor: copied ? "rgba(201,176,255,0.22)" : `rgba(${fg},0.06)`,
            borderColor: copied ? "transparent" : `rgba(${fg},0.12)`,
          },
        ]}>
        {copied ? (
          <Svg width={10} height={10} viewBox="0 0 14 14">
            <Path
              d="M2.5 7.5L5.5 10.5L11.5 3.5"
              stroke={tint}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        ) : (
          <Svg width={9} height={9} viewBox="0 0 14 14">
            <Rect x={4.5} y={4.5} width={7} height={7} rx={1.6} stroke={tint} strokeWidth={1.5} fill="none" />
            <Path
              d="M9.5 4.5V3.2A1.2 1.2 0 008.3 2H3.2A1.2 1.2 0 002 3.2v5.1A1.2 1.2 0 003.2 9.5h1.3"
              stroke={tint}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    height: 18,
    width: 18,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
