/**
 * LockScreen.tsx — the wallet's front door.
 *
 * The lilac sky, cloud banks along the floor, and the mark floating over the
 * middle. The mark WATCHES YOU TYPE: PasswordField reports where its caret is
 * in window coordinates and the eyes aim at it, each from its own socket, so
 * they converge on the character just entered.
 *
 * Unlock choreography: the whole screen simply SLIDES OFF TO THE LEFT, in one
 * piece, while the wallet comes in from the right behind it. It used to break
 * itself up — form sinking, mark climbing out of frame, badge fading — and each
 * piece leaving on its own schedule read as three things happening rather than
 * one screen being replaced. The slide is driven by `progress`, which App owns
 * and the wallet reads too; see the hand-over note in App.tsx.
 *
 * A wrong password shakes the field instead.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  InteractionManager,
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
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

export default function LockScreen({
  progress,
  durationMs,
  onDecrypted,
  onExited,
}: {
  /** The shared hand-over, 0 → 1. We start it; the wallet rides it too. */
  progress: Animated.Value;
  durationMs: number;
  /** Fires the moment the password checks out — App mounts the wallet beside us. */
  onDecrypted: () => void;
  /** Fires when the exit has finished — App can drop us now. */
  onExited: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { unlock } = useWallet();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gaze, setGaze] = useState<GazePoint | null>(null);

  const shake = useRef(new Animated.Value(0)).current;

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
    /* Correct. Hand over FIRST — the wallet mounts beside us while this screen
       still stands there saying "Unlocking…" — and only leave once that work is
       done. Playing the exit first and swapping after meant the animation ended
       into a second of empty lock screen while the wallet built itself.

       The keyboard goes before anything else and gets a beat to retract, or the
       window is still resizing while we slide: a layout pass per frame, on the
       one animation that has to be the smoothest in the app. */
    setGaze(null);
    Keyboard.dismiss();
    onDecrypted();
    setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        Animated.timing(progress, {
          toValue: 1,
          duration: durationMs,
          easing: Easing.bezier(0.4, 0, 0.15, 1),
          useNativeDriver: true,
        }).start(({ finished }) => finished && onExited());
      });
    }, 90);
  }, [loading, password, unlock, progress, durationMs, onDecrypted, onExited]);

  /* The mark stops floating for the exit — a float and a slide fighting over
     the same pixels is what made the old exit look tugged. */
  const leaving = loading;

  /* One piece, straight off to the left. */
  const slideOut = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width] });

  return (
    <Animated.View style={[styles.fill, { transform: [{ translateX: slideOut }] }]}>
      {/* Rides the slide with everything else — it used to sit outside the exit
          entirely and stayed put for a second after the wallet had arrived. */}
      <View
        style={{
          position: "absolute",
          top: insets.top + 14,
          left: 18,
          zIndex: 20,
        }}>
        <CloudChip contentStyle={styles.brandChip} lobeBase={28}>
          <AnimatedLogo size={22} blink={false} />
          <MenoidWordmark height={13} tone="violet" />
        </CloudChip>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.center, { paddingBottom: insets.bottom + 110 }]}>
          <AnimatedLogo size={150} float={!leaving} blink gaze={gaze} style={{ marginBottom: 36 }} />

          <View style={styles.formBay}>
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
          </View>
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  formBay: { width: "100%", alignItems: "center" },
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
