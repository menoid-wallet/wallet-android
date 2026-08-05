/**
 * App.tsx — the top-level state machine.
 *
 *   loading     → deciding where to land (is there a stored wallet?)
 *   onboarding  → Welcome (intro → choose → create/import)
 *   locked      → LockScreen (enter password to decrypt)
 *   unlocked    → UnderDevelopment
 *
 * The decrypted keys live only in the WalletProvider's memory, so a cold start
 * always begins at "loading" → "locked" once a wallet exists.
 */
import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppFonts } from "./src/theme/fonts";
import { WalletProvider, useWallet } from "./src/context/WalletContext";
import { isOnboarded } from "./src/lib/wallets";
import { SKY_OPEN } from "./src/theme/tokens";
import Sky from "./src/components/brand/Sky";
import Welcome from "./src/components/setup/Welcome";
import LockScreen from "./src/components/setup/LockScreen";
import UnderDevelopment from "./src/components/UnderDevelopment";

type AppState = "loading" | "onboarding" | "locked" | "unlocked";

function Loading() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: SKY_OPEN.base, alignItems: "center", justifyContent: "center" }}>
      <Sky width={width} height={height} />
      <ActivityIndicator color="#fff" />
    </View>
  );
}

function AppInner() {
  const { lock } = useWallet();
  const [state, setState] = useState<AppState>("loading");

  useEffect(() => {
    (async () => {
      const onboarded = await isOnboarded();
      setState(onboarded ? "locked" : "onboarding");
    })();
  }, []);

  switch (state) {
    case "onboarding":
      return <Welcome onDone={() => setState("locked")} />;
    case "locked":
      return <LockScreen onUnlocked={() => setState("unlocked")} />;
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
      return <Loading />;
  }
}

export default function App() {
  const fontsLoaded = useAppFonts();
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {fontsLoaded ? (
        <WalletProvider>
          <AppInner />
        </WalletProvider>
      ) : (
        <Loading />
      )}
    </SafeAreaProvider>
  );
}
