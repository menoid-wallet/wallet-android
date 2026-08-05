/**
 * LockScreen.tsx — the wallet's front door.
 *
 * The lilac sky, cloud banks along the floor, and the mark floating over the
 * middle (blinking, gently bobbing). Type the password → unlock() decrypts the
 * stored keys into the session. A wrong password shakes the field.
 *
 * The field is much brighter glass than anything else on this screen, because
 * the type inside it is violet rather than white — a password is the one thing
 * worth reading a character at a time.
 */
import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Svg, { Path, Circle, Line } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Sky from "../brand/Sky";
import { CloudBank } from "../brand/Clouds";
import AnimatedLogo from "../brand/AnimatedLogo";
import CloudChip from "../brand/CloudChip";
import MenoidWordmark from "../brand/MenoidWordmark";
import { useWallet } from "../../context/WalletContext";
import { COLORS, FONT } from "../../theme/tokens";

export default function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { unlock } = useWallet();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  function runShake() {
    shake.setValue(0);
    Animated.sequence(
      [-8, 7, -4, 3, 0].map((to) =>
        Animated.timing(shake, { toValue: to, duration: 62, useNativeDriver: true })
      )
    ).start();
  }

  async function handleUnlock() {
    if (!password) {
      setError("Enter your password.");
      runShake();
      return;
    }
    setLoading(true);
    setError("");
    const ok = await unlock(password);
    if (ok) {
      onUnlocked();
    } else {
      setLoading(false);
      setError("Wrong password. Try again.");
      runShake();
    }
  }

  return (
    <View style={styles.fill}>
      <Sky width={width} height={height} />
      <CloudBank layer="mid" viewportWidth={width} style={{ position: "absolute", top: 0, left: 0 }} />

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
          <AnimatedLogo size={150} float blink style={{ marginBottom: 36 }} />

          <Animated.View
            style={[styles.field, !!error && styles.fieldError, { transform: [{ translateX: shake }] }]}>
            <TextInput
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setError("");
              }}
              secureTextEntry={!showPw}
              editable={!loading}
              autoFocus
              placeholder="Password"
              placeholderTextColor="rgba(78,47,142,0.45)"
              // Kill Android's own EditText underline/selection art — it is
              // drawn in the theme's magenta accent and reads as a pink bar
              // through this deliberately translucent field.
              underlineColorAndroid="transparent"
              selectionColor="rgba(78,47,142,0.25)"
              cursorColor={COLORS.violetDeep}
              // A wallet password has no business going to the platform
              // autofill service, so opt the field out entirely.
              importantForAutofill="no"
              autoComplete="off"
              textContentType="none"
              onSubmitEditing={handleUnlock}
              style={styles.input}
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
              contentStyle={styles.unlockBtn}>
              {loading && (
                <ActivityIndicator size="small" color={COLORS.violetDeep} style={{ marginRight: 10 }} />
              )}
              <Text style={styles.unlockText}>{loading ? "Unlocking…" : "Unlock"}</Text>
            </CloudChip>
          </View>
        </View>
      </KeyboardAvoidingView>

      <CloudBank layer="near" viewportWidth={width} style={{ position: "absolute", bottom: 0, left: 0 }} />
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
  input: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 17,
    fontFamily: FONT.roundSemi,
    fontSize: 18,
    letterSpacing: 2,
    color: COLORS.violetDeep,
    backgroundColor: "transparent",
  },
  eye: { paddingHorizontal: 15, paddingVertical: 10 },
  error: {
    marginTop: 16,
    fontFamily: FONT.roundBold,
    fontSize: 14.5,
    color: COLORS.errorInk,
    textAlign: "center",
  },
  unlockBtn: { paddingHorizontal: 44, paddingVertical: 15 },
  unlockText: { fontFamily: FONT.roundBold, fontSize: 17, color: COLORS.violetDeep },
});
