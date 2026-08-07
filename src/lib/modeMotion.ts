/**
 * modeMotion.ts — the single animated quantity that IS the open ↔ noid switch.
 *
 * The mode is not just which view is on screen. It is the colour of the sky
 * behind every screen, the tone of the cloud banks, the ink, and the position
 * of the pill's knob — and when you drag the page sideways, all of those have
 * to move together, in step with your thumb, or the gesture reads as a page
 * slide that happens to be followed by a theme change.
 *
 * WHY THIS IS A SCROLL OFFSET AND NOT A GESTURE VALUE.
 * The obvious build is a PanGestureHandler feeding an Animated.Value. It was
 * built that way first, and it was the slowest thing in the app: under the New
 * Architecture that handler's `Animated.event` lands on the UI thread rather
 * than the native animation driver, so every motion event re-applied the
 * carousel's transform synchronously — 400ms frames during a drag, against 57ms
 * for the identical animation run from the pill.
 *
 * So the carousel is a horizontal paging ScrollView, and the mode is simply
 * WHERE IT IS SCROLLED TO. Android's scroller runs the drag, the fling and the
 * page snap on its own; `Animated.event` on a ScrollView's contentOffset is the
 * one path RN drives natively for certain. Dragging and tapping the pill are
 * then the same motion — the tap just calls scrollTo — and everything reading
 * `modeMix` follows for free, on the native side, whichever way you did it.
 *
 * Module scope rather than context because the Backdrop is mounted in App.tsx,
 * above the provider tree, and WalletHome is several levels below it. A context
 * could carry the value down but not up.
 */

import { Animated } from "react-native";

/** The pager's horizontal offset in px: 0 = open, one page width = noid. */
export const modePage = new Animated.Value(0);

/** Page width, so the offset can be read as a fraction of a full switch. */
const pageWidth = new Animated.Value(1);

export function setModeWidth(w: number) {
  pageWidth.setValue(Math.max(1, w));
}

/** 0 = fully open, 1 = fully noid. Follows the finger and the fling alike. */
export const modeMix = Animated.divide(modePage, pageWidth).interpolate({
  inputRange: [0, 1],
  outputRange: [0, 1],
  extrapolate: "clamp",
});

/** Feed the pager's scroll straight into `modePage`, on the native driver. */
export const onModeScroll = Animated.event(
  [{ nativeEvent: { contentOffset: { x: modePage } } }],
  { useNativeDriver: true }
);
