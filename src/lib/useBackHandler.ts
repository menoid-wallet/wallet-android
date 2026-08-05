/**
 * useBackHandler — map Android's hardware/gesture Back onto in-app navigation.
 *
 * Without this, Back finishes the activity and drops the user out of the app
 * from ANY screen — halfway through creating a wallet included. A browser
 * extension never had to answer this; a phone app does.
 *
 * Return true from the handler to say "I handled it"; return false to let
 * Android do its default thing (leave the app), which is what the first screen
 * of the flow should do.
 */
import { useEffect } from "react";
import { BackHandler } from "react-native";

export function useBackHandler(handler: () => boolean) {
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", handler);
    return () => sub.remove();
  }, [handler]);
}
