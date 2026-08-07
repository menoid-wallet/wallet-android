/**
 * useKeyboardHeight — how much of the screen the keyboard is currently eating.
 *
 * LiquidSheet lifts a snapped sheet by exactly this, which keeps a footer
 * sitting on the keyboard. A pane inside such a sheet therefore has to give the
 * same amount back — `top: kb` to hold its head still and `height − kb` to keep
 * its foot just above the keys — or the sheet's header slides off the top of
 * the screen while only the button stays where it should.
 */

import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setHeight(0)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
