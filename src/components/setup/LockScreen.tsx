/**
 * LockScreen.tsx — the wallet's front door.
 *
 * The lilac sky, cloud banks along the floor, and the mark floating over the
 * middle. The mark WATCHES YOU TYPE: PasswordField reports where its caret is
 * in window coordinates and the eyes aim at it, each from its own socket, so
 * they converge on the character just entered.
 *
 * Unlock choreography (the reward for getting it right):
 *   1. the form sinks and fades out
 *   2. the mark rises up out of the sky
 *   3. only then does the app hand over to the unlocked screen
 * A wrong password shakes the field instead.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Svg, { Path, Circle, Line } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AnimatedLogo, { type GazePoint } from "../brand/AnimatedLogo";
import CloudChip from "../brand/CloudChip";
import MenoidWordmark from "../brand/MenoidWordmark";
import PasswordField from "../shared/PasswordField";
import { useWallet } from "../../context/WalletContext";
import { COLORS, FONT } from "../../theme/tokens";

export default function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { unlock } = useWallet();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gaze, setGaze] = useState<GazePoint | null>(null);

  const shake = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current; // 0 = resting, 1 = gone

  function runShake() {
    shake.setValue(0);
    Animated.sequence(
      [-8, 7, -4, 3, 0].map((to) =>
        Animated.timing(shake, { toValue: to, duration: 62, useNativeDriver: true })
      )
    ).start();
  }

  const handleUnlock = useCallback(async () => {
    if (loading) return;
    if (!password) {
      setError("Enter your password.");
      runShake();
      return;
    }
    setLoading(true);
    setError("");
    const ok = await unlock(password);
    if (!ok) {
      setLoading(false);
      setError("Wrong password. Try again.");
      runShake();
      return;
    }
    // Correct: play the hand-off, THEN swap screens.
    setGaze(null);
    Animated.timing(exit, {
      toValue: 1,
      duration: 620,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => finished && onUnlocked());
  }, [loading, password, unlock, exit, onUnlocked]);

  /* form sinks, mark climbs out of frame */
  const formShift = exit.interpolate({ inputRange: [0, 1], outputRange: [0, 150] });
  const formFade = exit.interpolate({ inputRange: [0, 0.55], outputRange: [1, 0], extrapolate: "clamp" });
  const markShift = exit.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.55] });
  const markScale = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] });
  const markFade = exit.interpolate({ inputRange: [0.45, 1], outputRange: [1, 0], extrapolate: "clamp" });

  return (
    <View style={styles.fill}>
      <View style={{ position: "absolute", top: insets.top + 14, left: 18, zIndex: 20 }}>
        <CloudChip contentStyle={styles.brandChip} lobeBase={28}>
          <AnimatedLogo size={22} blink={false} />
          <MenoidWordmark height={13} tone="violet" />
        </CloudChip>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.center, { paddingBottom: insets.bottom + 110 }]}>
          <Animated.View
            style={{
              opacity: markFade,
              transform: [{ translateY: markShift }, { scale: markScale }],
            }}>
            <AnimatedLogo size={150} float blink gaze={gaze} style={{ marginBottom: 36 }} />
          </Animated.View>

          <Animated.View
            style={{
              width: "100%",
              alignItems: "center",
              opacity: formFade,
              transform: [{ translateY: formShift }],
            }}>
            <Animated.View
              style={[styles.field, !!error && styles.fieldError, { transform: [{ translateX: shake }] }]}>
              <PasswordField
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  setError("");
                }}
                editable={!loading}
                autoFocus
                onSubmitEditing={handleUnlock}
                onCaretMove={setGaze}
                tone="violet"
                reveal={showPw}
                dotSize={10}
                advance={showPw ? 20 : 22}
                style={{ paddingLeft: 20 }}
              />
              <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={12} style={styles.eye}>
                <Svg width={21} height={21} viewBox="0 0 16 16" fill="none">
                  <Path
                    d="M1 8S3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8Z"
                    stroke={COLORS.violetDeep}
                    strokeWidth={1.4}
                    opacity={0.75}
                  />
                  <Circle cx={8} cy={8} r={2} stroke={COLORS.violetDeep} strokeWidth={1.4} opacity={0.75} />
                  {!showPw && (
                    <Line
                      x1={2}
                      y1={2}
                      x2={14}
                      y2={14}
                      stroke={COLORS.violetDeep}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      opacity={0.75}
                    />
                  )}
                </Svg>
              </Pressable>
            </Animated.View>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <View style={{ marginTop: 30 }}>
              <CloudChip
                onPress={handleUnlock}
                disabled={loading || !password}
                lobeBase={32}
                tone={loading ? "loading" : "light"}
                contentStyle={styles.unlockBtn}>
                {loading && (
                  <ActivityIndicator size="small" color={COLORS.violetDeep} style={styles.unlockSpinner} />
                )}
                <Text style={styles.unlockText}>{loading ? "Unlocking…" : "Unlock"}</Text>
              </CloudChip>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  brandChip: { gap: 7, paddingHorizontal: 15, paddingVertical: 7 },

  field: {
    width: "100%",
    maxWidth: 330,
    minHeight: 60,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.78)",
    /* Deliberately NO elevation/shadow. On Android an elevation forces this
       translucent pill into its own hardware layer, and the nested TextInput's
       text box then composites at a different alpha — which drew a pale
       rectangle across the field that ignored the corner radius. Same trap as
       the glass Panel in SetupUI. The bright fill + white hairline carry it. */
  },
  fieldError: { backgroundColor: "rgba(255,244,247,0.72)", borderColor: "rgba(214,92,140,0.7)" },
  eye: { paddingHorizontal: 15, paddingVertical: 10 },
  error: {
    marginTop: 16,
    fontFamily: FONT.roundBold,
    fontSize: 14.5,
    color: COLORS.errorInk,
    textAlign: "center",
  },
  /* Fixed width. "Unlock" → spinner + "Unlocking…" is a wider run, and letting
     the cloud re-measure made the whole silhouette slide left mid-press. */
  unlockBtn: { width: 210, paddingVertical: 15, justifyContent: "center" },
  unlockText: { fontFamily: FONT.roundBold, fontSize: 17, color: COLORS.violetDeep },
  unlockSpinner: { position: "absolute", left: 26 },
});
