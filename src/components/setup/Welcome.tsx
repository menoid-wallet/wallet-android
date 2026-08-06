/**
 * Welcome.tsx — first-run onboarding, in the Menoid sky.
 *
 *   intro   → the blinking mark on its cloud, the greeting, a next arrow
 *   choose  → two cloud doors: Create wallet / Import wallet
 *   create / import → the flows, inline
 *
 * Both flows end by calling onDone(), which App turns into the lock screen.
 */
import React, { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, useWindowDimensions, ActivityIndicator } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StillCloud } from "../brand/Clouds";
import AnimatedLogo from "../brand/AnimatedLogo";
import MenoidWordmark from "../brand/MenoidWordmark";
import CloudChip from "../brand/CloudChip";
import { COLORS, FONT } from "../../theme/tokens";
import { useBackHandler } from "../../lib/useBackHandler";
import SlideTransition from "../shared/SlideTransition";
import CreateWallet from "./CreateWallet";
import ImportWallet from "./ImportWallet";

type Screen = "intro" | "choose" | "create" | "import";

export default function Welcome({ onDone }: { onDone: () => void }) {
  const [screen, setScreen] = useState<Screen>("intro");
  const dir = useRef<"forward" | "back">("forward");
  const go = (next: Screen, d: "forward" | "back" = "forward") => {
    dir.current = d;
    setScreen(next);
  };

  /* Every screen — including the two flows — goes through the transition.
     Returning CreateWallet/ImportWallet above it (as this used to) made
     choose → seed phrase a hard cut with no animation at all. */
  return (
    <SlideTransition routeKey={screen} direction={dir.current}>
      {screen === "intro" ? (
        <Intro onNext={() => go("choose")} />
      ) : screen === "choose" ? (
        <Choose
          onBack={() => go("intro", "back")}
          onCreate={() => go("create")}
          onImport={() => go("import")}
        />
      ) : screen === "create" ? (
        <CreateWallet onBack={() => go("choose", "back")} onCreated={onDone} />
      ) : (
        <ImportWallet onBack={() => go("choose", "back")} onImported={onDone} />
      )}
    </SlideTransition>
  );
}

/* ── intro ─────────────────────────────────────────────────────────────────── */
function Intro({ onNext }: { onNext: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const markSize = Math.min(width * 0.46, 188);

  return (
    <View style={styles.fill}>
      <View style={{ position: "absolute", top: insets.top + 14, alignSelf: "center", zIndex: 20 }}>
        <CloudChip contentStyle={styles.wordChip} lobeBase={28}>
          <MenoidWordmark height={15} tone="violet" />
        </CloudChip>
      </View>

      {/* The copy block owns the middle of the sky; the arrow is parked on the
          floor. Previously everything was one centred stack, which left the
          whole page hugging the top with dead space beneath it. */}
      <View style={[styles.introBody, { paddingTop: insets.top + 70 }]}>
        {/* The mark standing ON its cloud: the cloud is drawn FIRST (so it sits
            behind the opaque artwork) and pinned to the base of the block, so
            it peeks out around the mark's feet instead of covering it. */}
        <View style={{ alignItems: "center", marginBottom: 40, height: markSize * 1.12 }}>
          <StillCloud
            width={markSize * 1.62}
            style={{ position: "absolute", bottom: 0, opacity: 0.97 }}
          />
          <AnimatedLogo size={markSize} float blink />
        </View>

        <Text style={styles.welcome}>Welcome to Menoid</Text>
        <Text style={styles.tagline}>Your entry point to the private crypto world</Text>
      </View>

      <View style={[styles.introFoot, { paddingBottom: insets.bottom + 84 }]}>
        <Pressable
          onPress={onNext}
          hitSlop={14}
          style={({ pressed }) => [styles.next, pressed && { transform: [{ scale: 0.93 }] }]}>
          <Svg width={30} height={22} viewBox="0 0 22 16" fill="none">
            <Path
              d="M2 8H19M19 8L13 2M19 8L13 14"
              stroke={COLORS.violetDeep}
              strokeWidth={2.1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

/* ── choose ────────────────────────────────────────────────────────────────── */
function Choose({
  onBack,
  onCreate,
  onImport,
}: {
  onBack: () => void;
  onCreate: () => void;
  onImport: () => void;
}) {
  const insets = useSafeAreaInsets();
  /* The pressed door marks itself busy for the length of the transition so a
     second tap can't queue another one; the flow itself now animates in, and
     the seed phrase is generated after the animation (see CreateWallet). */
  const [busy, setBusy] = useState<"create" | "import" | null>(null);
  const start = (which: "create" | "import", run: () => void) => {
    if (busy) return;
    setBusy(which);
    run();
  };

  // Back returns to the greeting rather than leaving the app.
  useBackHandler(
    useCallback(() => {
      onBack();
      return true;
    }, [onBack])
  );

  return (
    <View style={styles.fill}>
      <View style={{ position: "absolute", top: insets.top + 12, left: 18, zIndex: 20 }}>
        <Pressable onPress={onBack} hitSlop={16} style={styles.backBtn}>
          <Svg width={20} height={11} viewBox="0 0 18 9" fill="none">
            <Path
              d="M18 4.5H2M2 4.5L5.5 1M2 4.5L5.5 8"
              stroke="rgba(255,255,255,0.92)"
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          </Svg>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      <View style={[styles.center, { paddingBottom: insets.bottom + 110 }]}>
        <AnimatedLogo size={104} blink style={{ marginBottom: 22 }} />
        <Text style={styles.chooseTitle}>Set up your wallet</Text>
        <Text style={styles.chooseSub}>
          Start a brand new private account, or bring an existing one with you.
        </Text>

        <View style={styles.doors}>
          <Door
            title="Create wallet"
            desc="A new private account."
            busy={busy === "create"}
            dimmed={busy !== null && busy !== "create"}
            onPress={() => start("create", onCreate)}
            glyph={<Path d="M9 1V17M1 9H17" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />}
          />
          <Door
            title="Import wallet"
            desc="From a seed phrase or key."
            busy={busy === "import"}
            dimmed={busy !== null && busy !== "import"}
            onPress={() => start("import", onImport)}
            glyph={
              <Path
                d="M17 9H5M5 9L9 5M5 9L9 13M1 1V17"
                stroke="#fff"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            }
          />
        </View>
      </View>
    </View>
  );
}

/**
 * A door out of the sky: an actual cloud you press, rather than a glass
 * rectangle laid over the weather. Everything inside is violet, because the
 * silhouette is white.
 */
function Door({
  title,
  desc,
  glyph,
  onPress,
  busy,
  dimmed,
}: {
  title: string;
  desc: string;
  glyph: React.ReactNode;
  onPress: () => void;
  busy?: boolean;
  dimmed?: boolean;
}) {
  return (
    <CloudChip
      fullWidth
      onPress={onPress}
      disabled={busy || dimmed}
      radius={26}
      lobeBase={40}
      tone={busy ? "loading" : "light"}
      contentStyle={styles.doorContent}>
      <View style={[styles.doorDisc, busy && { backgroundColor: "#6F4FC4" }]}>
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
            {glyph}
          </Svg>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.doorTitle}>{busy ? "Just a moment…" : title}</Text>
        <Text style={styles.doorDesc}>{busy ? "Preparing your wallet." : desc}</Text>
      </View>
      {!busy && (
        <Svg width={22} height={10} viewBox="0 0 22 9" fill="none">
          <Path
            d="M0 4.5H20M20 4.5L16.5 1M20 4.5L16.5 8"
            stroke={COLORS.violetDeep}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </Svg>
      )}
    </CloudChip>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 26 },
  introBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 26 },
  introFoot: { alignItems: "center" },
  wordChip: { paddingHorizontal: 20, paddingVertical: 8 },

  backBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  backText: { fontFamily: FONT.roundSemi, fontSize: 15, color: "rgba(255,255,255,0.92)" },

  welcome: {
    fontFamily: FONT.roundBold,
    fontSize: 34,
    lineHeight: 40,
    color: "#fff",
    textAlign: "center",
    textShadowColor: "rgba(48,26,96,0.32)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  tagline: {
    marginTop: 14,
    fontFamily: FONT.body,
    fontSize: 17,
    lineHeight: 25,
    color: "rgba(255,255,255,0.88)",
    textAlign: "center",
    maxWidth: 320,
  },
  next: {
    marginTop: 44,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#F6EFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#40247A",
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 9,
  },

  chooseTitle: {
    fontFamily: FONT.roundBold,
    fontSize: 30,
    color: "#fff",
    textAlign: "center",
    textShadowColor: "rgba(48,26,96,0.32)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  chooseSub: {
    marginTop: 12,
    fontFamily: FONT.body,
    fontSize: 16,
    lineHeight: 24,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    maxWidth: 330,
  },

  doors: { width: "100%", maxWidth: 400, gap: 30, marginTop: 42 },
  doorContent: { gap: 16, paddingHorizontal: 22, paddingVertical: 20 },
  doorDisc: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.violetDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  doorTitle: { fontFamily: FONT.roundBold, fontSize: 19, color: COLORS.violetDeep },
  doorDesc: { fontFamily: FONT.body, fontSize: 13.5, color: "rgba(78,47,142,0.68)", marginTop: 3 },
});
