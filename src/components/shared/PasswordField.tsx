/**
 * PasswordField.tsx — a password input we draw ourselves.
 *
 * Android's own `secureTextEntry` masks the character you just typed after
 * roughly a tenth of a second, which is too fast to read back — and it gives no
 * control over bead size or any way to know where the last character sits on
 * screen. All three of those are things this app needs, so the real <TextInput>
 * is kept for input handling only (transparent text, no native caret) and the
 * beads, the caret and the reveal are rendered on top.
 *
 *   - the newest character stays legible for `revealMs` before it becomes a dot
 *   - beads are big and widely tracked, like the extension's monospace field
 *   - onCaretMove reports the caret's position in WINDOW coordinates, which is
 *     what the mark's eyes aim at on the lock screen
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Animated,
  StyleSheet,
  Easing,
  ViewStyle,
  LayoutChangeEvent,
} from "react-native";
import { COLORS, FONT } from "../../theme/tokens";

export type CaretPoint = { x: number; y: number };

const REVEAL_MS = 1400;

export default function PasswordField({
  value,
  onChangeText,
  placeholder = "Password",
  editable = true,
  autoFocus,
  onSubmitEditing,
  tone = "violet",
  dotSize = 9,
  advance = 20,
  reveal: revealAll = false,
  onCaretMove,
  style,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  /** violet = on the bright lock-screen glass; white = on a dark glass panel */
  tone?: "violet" | "white";
  dotSize?: number;
  advance?: number;
  /** show every character, not just the newest one (the eye toggle) */
  reveal?: boolean;
  onCaretMove?: (p: CaretPoint | null) => void;
  style?: ViewStyle;
}) {
  const ink = tone === "violet" ? COLORS.violetDeep : "#FFFFFF";
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(-1); // index shown as a real character
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<View | null>(null);
  const [rowW, setRowW] = useState(0);

  const caretBlink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!focused) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(caretBlink, { toValue: 0, duration: 480, delay: 380, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(caretBlink, { toValue: 1, duration: 480, easing: Easing.linear, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [focused, caretBlink]);

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  }, []);

  /* How far the run has to slide left to keep the caret in view. */
  const contentW = value.length * advance;
  const shift = rowW > 0 && contentW + 6 > rowW ? rowW - contentW - 6 : 0;

  /** Tell the caller where the caret is, in window space. */
  const reportCaret = useCallback(
    (len: number) => {
      if (!onCaretMove) return;
      const node = rowRef.current;
      if (!node) return;
      node.measureInWindow((x, y, w, h) => {
        if (!w && !h) return;
        const localX = Math.min(len * advance + shift, w);
        onCaretMove({ x: x + localX, y: y + h / 2 });
      });
    },
    [onCaretMove, advance, shift]
  );

  const handleChange = (t: string) => {
    onChangeText(t);
    if (t.length > value.length) {
      setReveal(t.length - 1);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setReveal(-1), REVEAL_MS);
    } else {
      setReveal(-1);
    }
    reportCaret(t.length);
  };

  const onRowLayout = (e: LayoutChangeEvent) => {
    setRowW(e.nativeEvent.layout.width);
    reportCaret(value.length);
  };

  return (
    <View style={[styles.wrap, style]} ref={rowRef} onLayout={onRowLayout} collapsable={false}>
      {/* real input: handles the keyboard, selection and paste — but draws
          nothing, so the beads below are the only thing visible */}
      <TextInput
        value={value}
        onChangeText={handleChange}
        editable={editable}
        autoFocus={autoFocus}
        onFocus={() => {
          setFocused(true);
          reportCaret(value.length);
        }}
        onBlur={() => {
          setFocused(false);
          onCaretMove?.(null);
        }}
        onSubmitEditing={onSubmitEditing}
        caretHidden
        underlineColorAndroid="transparent"
        importantForAutofill="no"
        autoComplete="off"
        autoCorrect={false}
        autoCapitalize="none"
        textContentType="none"
        spellCheck={false}
        selectionColor="transparent"
        style={[StyleSheet.absoluteFill, styles.input]}
        /* opacity 0, not color:"transparent" — Android draws the IME's
           COMPOSING text in its own colour and ignores a transparent text
           colour, which left the real characters visible over the beads. */
      />

      <View style={styles.beads} pointerEvents="none">
        {value.length === 0 && !focused && (
          <Text style={[styles.placeholder, { color: tone === "violet" ? "rgba(78,47,142,0.45)" : "rgba(255,255,255,0.42)" }]}>
            {placeholder}
          </Text>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", transform: [{ translateX: shift }] }}>
          {value.split("").map((ch, i) =>
            revealAll || i === reveal ? (
              <View key={i} style={{ width: advance, alignItems: "center" }}>
                <Text style={[styles.char, { color: ink, fontSize: dotSize * 2 }]}>{ch}</Text>
              </View>
            ) : (
              <View key={i} style={{ width: advance, alignItems: "center" }}>
                <View
                  style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: ink,
                  }}
                />
              </View>
            )
          )}
          {focused && (
            <Animated.View
              style={{
                width: 2,
                height: dotSize * 2.1,
                marginLeft: 1,
                borderRadius: 1,
                backgroundColor: ink,
                opacity: caretBlink,
              }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", minHeight: 26 },
  // fully invisible: it still takes focus, keystrokes and paste, but paints
  // nothing at all — the beads below are the only thing on screen
  input: { opacity: 0, padding: 0, fontSize: 18, color: "#000" },
  beads: { justifyContent: "center", overflow: "hidden" },
  placeholder: { position: "absolute", fontFamily: FONT.round, fontSize: 16, letterSpacing: 0.5 },
  char: { fontFamily: FONT.mono, fontWeight: "700", textAlign: "center" },
});
