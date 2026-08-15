/**
 * App.tsx — the top-level state machine.
 *
 *   onboarding  → Welcome (intro → choose → create/import)
 *   locked      → LockScreen (enter password to decrypt)
 *   unlocked    → WalletHome
 *
 * TWO THINGS HAPPEN HERE THAT THE SCREENS RELY ON:
 *
 * 1. THE BACKDROP IS MOUNTED ONCE, here, for the life of the app. The sky and
 *    the drifting cloud banks are not part of any screen, so the drift never
 *    restarts and a screen change costs only the screen's own content. Screens
 *    are transparent and draw no weather of their own. It now also owns the
 *    open ↔ noid cross-fade, which is why the whole tree — backdrop included —
 *    sits inside the WalletProvider: the mode has to reach the sky.
 *
 * 2. NOTHING IS SHOWN UNTIL EVERYTHING IS READY. The native splash stays up
 *    until the fonts, the mark's bitmap and the "is there a wallet?" answer are
 *    all in hand — AND until the backdrop has had a beat to rasterise behind
 *    it. Rendering earlier is what made the first screen assemble itself in
 *    front of the user.
 *
 * The decrypted keys live only in the WalletProvider's memory, so a cold start
 * always begins at "locked" once a wallet exists.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { initAnalytics, track } from "./src/services/analytics";
import { Animated, View, Image, StyleSheet, InteractionManager } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppFonts } from "./src/theme/fonts";
import { WalletProvider, useWallet } from "./src/context/WalletContext";
import { PoolProvider } from "./src/context/PoolContext";
import { isOnboarded } from "./src/lib/wallets";
import { SKY_OPEN } from "./src/theme/tokens";
import Backdrop from "./src/components/brand/Backdrop";
import Welcome from "./src/components/setup/Welcome";
import LockScreen from "./src/components/setup/LockScreen";
import WalletHome from "./src/components/WalletHome";
import { ZkProverHost } from "./src/services/zkProver";

const MARK = require("./assets/brand/menoid-logo-blank.png");

SplashScreen.preventAutoHideAsync().catch(() => {});

type AppState = "onboarding" | "locked" | "unlocked";

/* The weather, wired to the wallet. The noid half is only BUILT once a session
   exists — onboarding and the lock screen can never show it, and a second
   full-screen gradient before the splash lifts is the exact cost the warm-up
   below exists to avoid. */
function ModeBackdrop() {
  const { mode, isUnlocked } = useWallet();
  return <Backdrop isNoid={isUnlocked && mode === "noid"} enableNoid={isUnlocked} />;
}

/**
 * THE UNLOCK HAND-OVER IS ONE ANIMATION SHARED BY TWO SCREENS.
 *
 * `handoff` runs 0 → 1 exactly once per unlock: the lock screen slides out to
 * the left on it, and the wallet comes in from the right — growing to full size
 * as it arrives — on the same value. It lives HERE, above both, and not one
 * value in each, because two timings started from the same callback still begin
 * a frame apart (the second one has to wait for a React commit first), and a
 * frame of skew between two halves that are meant to tile is a seam you can
 * see. One value, one native node, no seam. The lock screen owns starting it,
 * since it is the one that knows the password was right.
 *
 * The wallet is also MOUNTED the instant the password checks out, parked
 * off-screen right, while the lock screen still stands there saying
 * "Unlocking…". It is an expensive mount — six token bars, the treasure card
 * and all of its weather — and playing the exit first meant the animation
 * finished into a second of empty lock screen while that mount blocked the JS
 * thread. Nothing is ever on screen with nothing happening.
 */
const HANDOFF_MS = 820;

function AppInner({ initial }: { initial: AppState }) {
  const { lock } = useWallet();
  const [state, setState] = useState<AppState>(initial);
  const [lockMounted, setLockMounted] = useState(initial === "locked");
  const handoff = useRef(new Animated.Value(0)).current;

  const relock = useCallback(() => {
    setState("locked");
    setLockMounted(true);
    handoff.setValue(0);
  }, [handoff]);

  if (state === "onboarding") {
    return <Welcome onDone={relock} />;
  }

  return (
    /* Clipped, or the lock screen is still there off to the left — Android will
       happily draw a child outside its parent's bounds. */
    <View style={styles.stage}>
      {state === "unlocked" && (
        <WalletHome
          arrive={handoff}
          onLock={() => {
            lock();
            relock();
          }}
        />
      )}

      {lockMounted && (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen
            progress={handoff}
            durationMs={HANDOFF_MS}
            onDecrypted={() => setState("unlocked")}
            onExited={() => setLockMounted(false)}
          />
        </View>
      )}
    </View>
  );
}

export default function App() {
  const fontsLoaded = useAppFonts();
  const [markReady, setMarkReady] = useState(false);
  const [initial, setInitial] = useState<AppState | null>(null);
  const [warmed, setWarmed] = useState(false);

  useEffect(() => {
    isOnboarded().then((yes) => setInitial(yes ? "locked" : "onboarding"));
    /* Reports the install and starts the flush timer. Idempotent, so it runs on
       every launch — see services/analytics. */
    void initAnalytics({ appVersion: "0.0.1" });
  }, []);

  const loaded = fontsLoaded && markReady && initial !== null;

  /* Give the backdrop one settled frame to rasterise (it is a full-screen
     gradient, a grid path and two cloud banks) BEFORE the splash lifts. This is
     the difference between the first screen appearing finished and it hitching
     as it draws itself. */
  useEffect(() => {
    if (!loaded) return;
    const task = InteractionManager.runAfterInteractions(() => setWarmed(true));
    return () => task.cancel();
  }, [loaded]);

  useEffect(() => {
    if (warmed) SplashScreen.hideAsync().catch(() => {});
  }, [warmed]);

  return (
    /* GestureHandlerRootView must be the OUTERMOST view: every pan gesture in
       the app (the mode swipe, the sheet drags) is handled on the UI thread by
       gesture-handler, and it can only see touches that enter through here. */
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <WalletProvider>
          {/* The private balances. Inside WalletProvider because it needs the
              decrypted noid keys, and around everything because noid mode's
              dashboard and its coin pages both read the same sync. */}
          <PoolProvider>
          <View style={styles.root}>
            {/* mounted from the very first render, so it is warm and continuous */}
            <ModeBackdrop />

            {/* The prover's engine. Invisible, mounted once, warm before the
                first proof is asked for. */}
            <ZkProverHost />

            {loaded ? (
              <View style={StyleSheet.absoluteFill}>
                <AppInner initial={initial} />
              </View>
            ) : (
              /* Decodes the mark while the splash still covers everything.
                 Image.prefetch does NOT work on a bundled require()d asset —
                 onLoad firing is the only proof the bitmap is in memory. */
              <Image
                source={MARK}
                style={styles.preload}
                fadeDuration={0}
                onLoad={() => setMarkReady(true)}
                onError={() => setMarkReady(true)}
              />
            )}
          </View>
          </PoolProvider>
        </WalletProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SKY_OPEN.base },
  stage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" },
  preload: { width: 1, height: 1, opacity: 0 },
});
