/**
 * KeyEntryRow.tsx — one row inside the treasure card's "Copy Keys" popover.
 *
 * Ported from the extension's shared/KeyEntryRow.tsx: the chain crest, the
 * truncated address, and a copy glyph that morphs into a check on success.
 * Self-contained copied-state so the popover above stays declarative.
 *
 * Rendered on the dark popover surface in BOTH modes, so unlike almost
 * everything else on this screen its colours are fixed rather than themed.
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import type { ChainIconProps } from "../../lib/chains";
import { FONT } from "../../theme/tokens";

const ACCENT = "#E4D6FF";

function trunc(s: string, a = 12, b = 10) {
  if (!s) return "—";
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s;
}

export default memo(function KeyEntryRow({
  Icon,
  value,
}: {
  Icon: React.FC<ChainIconProps>;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = () => {
    if (!value) return;
    void Clipboard.setStringAsync(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Pressable
      onPress={copy}
      style={[styles.row, copied && { backgroundColor: "rgba(201,176,255,0.12)" }]}>
      <View style={styles.crest}>
        <Icon size={16} color={ACCENT} />
      </View>

      <Text style={styles.addr} numberOfLines={1}>
        {trunc(value)}
      </Text>

      <View
        style={[
          styles.action,
          { backgroundColor: copied ? "rgba(201,176,255,0.2)" : "rgba(244,238,255,0.06)" },
        ]}>
        {copied ? (
          <Svg width={12} height={12} viewBox="0 0 14 14">
            <Path
              d="M2.5 7.5L5.5 10.5L11.5 3.5"
              stroke={ACCENT}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </Svg>
        ) : (
          <Svg width={11} height={11} viewBox="0 0 14 14">
            <Rect
              x={4.5}
              y={4.5}
              width={7}
              height={7}
              rx={1.6}
              stroke="rgba(244,238,255,0.55)"
              strokeWidth={1.3}
              fill="none"
            />
            <Path
              d="M9.5 4.5V3.2A1.2 1.2 0 008.3 2H3.2A1.2 1.2 0 002 3.2v5.1A1.2 1.2 0 003.2 9.5h1.3"
              stroke="rgba(244,238,255,0.55)"
              strokeWidth={1.3}
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    padding: 6,
  },
  crest: {
    height: 24,
    width: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(228,214,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(228,214,255,0.26)",
  },
  addr: {
    flex: 1,
    fontFamily: FONT.mono,
    fontSize: 10.5,
    color: "rgba(255,255,255,0.85)",
  },
  action: {
    height: 24,
    width: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
