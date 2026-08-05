/**
 * SetupUI.tsx — the kit the create / import flows are built from.
 *
 * Ported from the extension's brand/SetupUI.tsx, with the type scale opened up
 * for a phone held at arm's length (the extension's 11–15px is a desktop popup
 * scale and reads as fine print on a 412dp screen).
 *
 * The important piece is <Panel>: a real glass card — translucent white fill,
 * a bright hairline border, an inner top highlight and a deep soft shadow.
 * Content sitting directly on the sky with no card is what made the first
 * attempt look unfinished.
 */
import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  ViewStyle,
} from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Sky from "../brand/Sky";
import { CloudBank } from "../brand/Clouds";
import AnimatedLogo from "../brand/AnimatedLogo";
import MenoidWordmark from "../brand/MenoidWordmark";
import CloudChip from "../brand/CloudChip";
import { COLORS, FONT } from "../../theme/tokens";

const VIOLET = COLORS.violetDeep;

/* ── shell: sky + header + scrolling body ─────────────────────────────────── */
export function SetupShell({
  steps,
  step,
  onBack,
  children,
}: {
  steps: string[];
  step: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const idx = steps.indexOf(step);

  return (
    <View style={styles.fill}>
      <Sky width={width} height={height} />
      <CloudBank layer="mid" viewportWidth={width} style={{ position: "absolute", top: 0, left: 0 }} />
      {/* The cloud floor is WEATHER, so it is painted before the content — a
          bank rendered after the ScrollView draws on top of it and swallows the
          bottom of a tall card (the 12-word phrase panel). Clouds still show
          through wherever the content is transparent. */}
      <CloudBank layer="near" viewportWidth={width} style={{ position: "absolute", bottom: 0, left: 0 }} />

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* header: brand chip + back, then the step rail */}
        {/* One row: brand chip on the left, step rail on the right. The chip's
            lobes bulge past its box, so nothing may sit directly under it. */}
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <CloudChip contentStyle={styles.brandChip} lobeBase={28}>
            <AnimatedLogo size={24} />
            <MenoidWordmark height={13} tone="violet" />
          </CloudChip>

          <View style={styles.dots}>
            {steps.map((s, i) => (
              <View
                key={s}
                style={[
                  styles.dot,
                  {
                    width: i === idx ? 24 : 10,
                    backgroundColor:
                      i === idx ? "#FFFFFF" : i < idx ? "rgba(255,255,255,0.85)" : "rgba(78,47,142,0.32)",
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <Pressable onPress={onBack} hitSlop={14} style={styles.backBtn}>
          <Svg width={20} height={11} viewBox="0 0 18 9" fill="none">
            <G stroke="rgba(255,255,255,0.9)" strokeWidth={1.6} strokeLinecap="round">
              <Path d="M18 4.5H2M2 4.5L5.5 1M2 4.5L5.5 8" />
            </G>
          </Svg>
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 200 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ── content atoms ────────────────────────────────────────────────────────── */

/** The glass card everything sits on. */
export function Panel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.panel, style]}>
      {/* inner top highlight — the lip of light along the top edge */}
      <View style={styles.panelHighlight} pointerEvents="none" />
      {children}
    </View>
  );
}

export function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={styles.kicker}>{String(children).toUpperCase()}</Text>;
}
export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}
export function Lede({ children }: { children: React.ReactNode }) {
  return <Text style={styles.lede}>{children}</Text>;
}
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{String(children).toUpperCase()}</Text>;
}
export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

/** A caution — amber would fight the sky, so it is a warmer white instead. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.note}>
      <Text style={styles.noteIcon}>⚠</Text>
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

export function Field({
  invalid,
  style,
  ...props
}: React.ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  return (
    <TextInput
      placeholderTextColor="rgba(255,255,255,0.42)"
      // Android draws its own EditText underline/handle art in the theme accent
      // (a magenta-pink), which shows straight through translucent glass.
      underlineColorAndroid="transparent"
      selectionColor="rgba(255,255,255,0.35)"
      cursorColor="#ffffff"
      // see LockScreen: opt out of the platform autofill highlight
      importantForAutofill="no"
      autoComplete="off"
      style={[styles.field, invalid && styles.fieldInvalid, style]}
      {...props}
    />
  );
}

export function TextArea(props: React.ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  return <Field multiline textAlignVertical="top" style={styles.textArea} {...props} />;
}

/** The primary action: a white cloud with violet type. */
export function CloudButton({
  children,
  onPress,
  disabled,
  loading,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <CloudChip
      fullWidth
      onPress={onPress}
      disabled={disabled || loading}
      lobeBase={34}
      contentStyle={styles.cloudBtn}>
      {loading && <ActivityIndicator size="small" color={VIOLET} style={{ marginRight: 10 }} />}
      <Text style={styles.cloudBtnText}>{children}</Text>
    </CloudChip>
  );
}

/** A quieter action — glass, so it never competes with the primary. */
export function GhostButton({
  children,
  onPress,
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.ghost, pressed && { backgroundColor: "rgba(255,255,255,0.22)" }]}>
      <Text style={styles.ghostText}>{children}</Text>
    </Pressable>
  );
}

/** Four bars and a word. */
export function StrengthMeter({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: "row", gap: 7 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              backgroundColor: i < score ? color : "rgba(255,255,255,0.22)",
            }}
          />
        ))}
      </View>
      <View style={styles.strengthRow}>
        <Text style={styles.strengthLabel}>STRENGTH</Text>
        <Text style={[styles.strengthValue, { color }]}>{label}</Text>
      </View>
    </View>
  );
}

export function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    zIndex: 20,
  },
  brandChip: { gap: 7, paddingHorizontal: 15, paddingVertical: 7 },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    // clears the brand chip's bottom lobes, which bulge past its box
    paddingTop: 30,
    paddingBottom: 6,
  },
  backText: { fontFamily: FONT.roundSemi, fontSize: 15, color: "rgba(255,255,255,0.9)" },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { height: 6, borderRadius: 3 },

  scroll: { paddingHorizontal: 18, paddingTop: 8 },

  /* NO elevation / shadow* here on purpose. Android paints the elevation
     shadow behind the view, and this card is translucent — so the shadow shows
     THROUGH the glass as a hard dark rectangle. The card reads off the sky from
     its fill + hairline border alone. */
  panel: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    borderRadius: 28,
    padding: 22,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.17)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  panelHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.35)",
  },

  kicker: {
    fontFamily: FONT.roundSemi,
    fontSize: 12,
    letterSpacing: 2.6,
    color: "rgba(255,255,255,0.72)",
    marginBottom: 10,
  },
  /* Keep textShadowRadius small. Android rasterises a large-radius text shadow
     as a filled box behind the glyphs, which reads as a grey plate. */
  title: {
    fontFamily: FONT.roundBold,
    fontSize: 27,
    lineHeight: 33,
    color: "#fff",
    textShadowColor: "rgba(48,26,96,0.3)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 5,
  },
  lede: {
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 23,
    color: "rgba(255,255,255,0.84)",
    marginTop: 10,
  },
  label: {
    fontFamily: FONT.roundSemi,
    fontSize: 12,
    letterSpacing: 2,
    color: "rgba(255,255,255,0.72)",
    marginBottom: 10,
  },
  error: { fontFamily: FONT.roundSemi, fontSize: 14, color: "#FFC4D6", marginTop: 10 },

  note: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,235,190,0.3)",
  },
  noteIcon: { color: "#FFE9A8", fontSize: 15, marginTop: 1 },
  noteText: { flex: 1, fontFamily: FONT.body, fontSize: 13.5, lineHeight: 20, color: "rgba(255,255,255,0.88)" },

  field: {
    width: "100%",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontFamily: FONT.round,
    fontSize: 17,
    color: "#fff",
  },
  fieldInvalid: { borderColor: "rgba(255,190,205,0.6)" },
  textArea: { minHeight: 110, paddingTop: 16, fontSize: 16, lineHeight: 24 },

  cloudBtn: { paddingHorizontal: 24, paddingVertical: 17 },
  cloudBtnText: { fontFamily: FONT.roundBold, fontSize: 17, color: VIOLET, textAlign: "center" },

  ghost: {
    width: "100%",
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  ghostText: { fontFamily: FONT.roundSemi, fontSize: 15.5, color: "#fff" },

  strengthRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 9 },
  strengthLabel: { fontFamily: FONT.roundSemi, fontSize: 11.5, letterSpacing: 1.8, color: "rgba(255,255,255,0.6)" },
  strengthValue: { fontFamily: FONT.roundBold, fontSize: 14 },

  factRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  factLabel: { fontFamily: FONT.roundSemi, fontSize: 11.5, letterSpacing: 1.6, color: "rgba(255,255,255,0.65)" },
  factValue: { flexShrink: 1, fontFamily: FONT.mono, fontSize: 13.5, color: "rgba(255,255,255,0.96)" },
});
