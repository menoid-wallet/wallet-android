/**
 * App.tsx — the top-level state machine.
 *
 *   onboarding  → Welcome (intro → choose → create/import)
 *   locked      → LockScreen (enter password to decrypt)
 *   unlocked    → UnderDevelopment
 *
 * TWO THINGS HAPPEN HERE THAT THE SCREENS RELY ON:
 *
 * 1. THE BACKDROP IS MOUNTED ONCE, here, for the life of the app. The sky and
 *    the drifting cloud banks are not part of any screen, so the drift never
 *    restarts and a screen change costs only the screen's own content. Screens
 *    are transparent and draw no weather of their own.
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
import React, { useEffect, useState } from "react";
import { View, Image, StyleSheet, InteractionManager } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppFonts } from "./src/theme/fonts";
import { WalletProvider, useWallet } from "./src/context/WalletContext";
import { isOnboarded } from "./src/lib/wallets";
import { SKY_OPEN } from "./src/theme/tokens";
import Backdrop from "./src/components/brand/Backdrop";
import Welcome from "./src/components/setup/Welcome";
import LockScreen from "./src/components/setup/LockScreen";
import UnderDevelopment from "./src/components/UnderDevelopment";

const MARK = require("./assets/brand/menoid-logo-blank.png");

SplashScreen.preventAutoHideAsync().catch(() => {});

type AppState = "onboarding" | "locked" | "unlocked";

function AppInner({ initial }: { initial: AppState }) {
  const { lock } = useWallet();
  const [state, setState] = useState<AppState>(initial);

  switch (state) {
    case "onboarding":
      return <Welcome onDone={() => setState("locked")} />;
    case "unlocked":
      return (
        <UnderDevelopment
          onLock={() => {
            lock();
            setState("locked");
          }}
        />
      );
    default:
      return <LockScreen onUnlocked={() => setState("unlocked")} />;
  }
}

export default function App() {
  const fontsLoaded = useAppFonts();
  const [markReady, setMarkReady] = useState(false);
  const [initial, setInitial] = useState<AppState | null>(null);
  const [warmed, setWarmed] = useState(false);

  useEffect(() => {
    isOnboarded().then((yes) => setInitial(yes ? "locked" : "onboarding"));
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
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {/* mounted from the very first render, so it is warm and continuous */}
        <Backdrop />

        {loaded ? (
          <View style={StyleSheet.absoluteFill}>
            <WalletProvider>
              <AppInner initial={initial} />
            </WalletProvider>
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
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SKY_OPEN.base },
  preload: { width: 1, height: 1, opacity: 0 },
});
