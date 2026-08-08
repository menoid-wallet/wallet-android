/**
 * LiquidSheet.tsx — the bottom sheet every action modal in the wallet sits in.
 *
 * Ported from the extension's shared/LiquidSheet.tsx, with its fullscreen mode
 * reworked: on a phone a sheet either hugs its content or occupies a fixed
 * fraction of the screen, and the send flow needs to move between those two
 * without a jump.
 *
 * HOW `snap` WORKS, AND WHY IT IS NOT AN ANIMATED HEIGHT.
 * Animating a height re-lays-out every child on every frame — with a keypad
 * inside, that is the whole sheet re-measured sixty times a second, and it
 * cannot use the native driver at all. So a snapped sheet is ALWAYS a
 * full-window-tall surface that is pushed DOWN by whatever fraction should stay
 * off-screen. `snap: 0.75` means "three quarters visible", i.e. shifted down by
 * a quarter of the window. Growing to full screen is then one native
 * translateY, and each stage simply lays its content out in the region that
 * happens to be visible.
 *
 * THE KEYBOARD IS HANDLED DIFFERENTLY IN THE TWO MODES. A content-sized sheet
 * is lifted bodily, which is all it needs. A SNAPPED sheet is not: its top edge
 * is a deliberate position on the screen, and sliding it up drags the header
 * off the top while the surface's unused lower half spills into the gap. So a
 * snapped sheet stays put and its content shortens instead — see
 * lib/useKeyboardHeight, which is what the panes inside it read.
 *
 * The drag is a gesture-handler pan feeding `Animated.event` on the grab area
 * only; dragging anywhere else would fight the form's inputs and the content
 * scroll.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type SheetTone = "cream" | "ink";

const DISMISS_PX = 90;
const FLICK_VELOCITY = 700; // px/s
const RUBBER_BAND = 0.32;

const SURFACE = {
  cream: {
    colors: ["#F7F2FF", "#ECE0FC", "#DCCDF7"] as const,
    border: "rgba(78,47,142,0.16)",
    handle: "rgba(78,47,142,0.25)",
    closeBg: "rgba(78,47,142,0.06)",
    closeLine: "rgba(78,47,142,0.14)",
    closeInk: "rgba(78,47,142,0.7)",
  },
  ink: {
    colors: ["#2B1A55", "#221244", "#1A1030"] as const,
    border: "rgba(244,238,255,0.14)",
    handle: "rgba(244,238,255,0.3)",
    closeBg: "rgba(244,238,255,0.08)",
    closeLine: "rgba(244,238,255,0.16)",
    closeInk: "rgba(244,238,255,0.75)",
  },
};

export default memo(function LiquidSheet({
  open,
  onClose,
  tone = "cream",
  disableDrag = false,
  hideClose = false,
  snap,
  scroll = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  tone?: SheetTone;
  /** Kills every dismissal path — used while a transaction is in flight. */
  disableDrag?: boolean;
  /**
   * Suppress the sheet's own close button. A full-screen stage puts it in the
   * status bar, so those stages draw their own somewhere sensible.
   */
  hideClose?: boolean;
  /**
   * Fraction of the window the sheet occupies, 0..1. Omit for a sheet that is
   * exactly as tall as its content. Changing it animates.
   */
  snap?: number;
  /** Put the content in a ScrollView. Off for stages that manage their own. */
  scroll?: boolean;
  children: React.ReactNode;
}) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = SURFACE[tone];
  const snapped = typeof snap === "number";

  const [mounted, setMounted] = useState(open);
  /* Seeded to the full window height so the very first frame is off-screen even
     before onLayout has run — otherwise the sheet paints in place for one frame
     and then jumps down to animate up, which reads as a flash. */
  const [sheetH, setSheetH] = useState(winH);

  const slide = useRef(new Animated.Value(0)).current; // 0 = away, 1 = seated
  const dragRaw = useRef(new Animated.Value(0)).current;
  const snapY = useRef(new Animated.Value(snapped ? (1 - snap!) * winH : 0)).current;
  const kbY = useRef(new Animated.Value(0)).current;

  /* Rubber band: downward drags track the finger 1:1 (you are dismissing it),
     upward ones are damped to about a third (there is nowhere to go). Done as
     an interpolation rather than in the gesture callback so it stays native. */
  const drag = useMemo(
    () =>
      dragRaw.interpolate({
        inputRange: [-1000, 0, 1000],
        outputRange: [-1000 * RUBBER_BAND, 0, 1000],
      }),
    [dragRaw]
  );

  useEffect(() => {
    if (!snapped) return;
    Animated.spring(snapY, {
      toValue: (1 - snap!) * winH,
      speed: 13,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  }, [snap, snapped, winH, snapY]);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        Animated.timing(kbY, {
          toValue: e.endCoordinates.height,
          duration: Platform.OS === "ios" ? e.duration || 240 : 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        Animated.timing(kbY, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [kbY]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(slide, {
        toValue: 1,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(slide, {
        toValue: 0,
        duration: 260,
        easing: Easing.bezier(0.4, 0, 1, 1),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          dragRaw.setValue(0);
        }
      });
    }
  }, [open, mounted, slide, dragRaw]);

  /* Hand-written rather than an Animated.event, and it MUST stay that way. On
     the New Architecture a gesture-handler cannot take a native-driven
     Animated.event: the event object is passed straight through as a prop and
     the first touch takes the app down with
       "Expected `onGestureHandlerEvent` listener to be a function".
     Dropping to useNativeDriver:false would fix the crash and cost far more —
     `dragRaw` feeds the same transform as the slide, so a JS-driven drag would
     drag the whole sheet's animation onto the JS thread with it. setValue on a
     native value writes straight through to the native graph, so only the event
     delivery is a JS hop and everything downstream stays where it was. */
  const onGesture = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      dragRaw.setValue(e.nativeEvent.translationY);
    },
    [dragRaw]
  );

  const onGestureState = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, translationY, velocityY } = e.nativeEvent;
      if (state !== State.END && state !== State.CANCELLED && state !== State.FAILED) return;
      if (state === State.END && (translationY > DISMISS_PX || velocityY > FLICK_VELOCITY)) {
        onClose();
        return;
      }
      Animated.spring(dragRaw, {
        toValue: 0,
        speed: 14,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    },
    [dragRaw, onClose]
  );

  if (!mounted) return null;

  const travel = snapped ? winH : sheetH;
  const slideY = Animated.add(
    slide.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }),
    snapY
  );
  const translateY = Animated.add(snapped ? slideY : Animated.subtract(slideY, kbY), drag);

  const body = scroll ? (
    <ScrollView
      style={snapped ? styles.bodyFill : styles.bodyHug}
      contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bounces={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={snapped ? styles.bodyFill : undefined}>{children}</View>
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (!disableDrag) onClose();
      }}>
      {/* A Modal's content view is its own React root, so it is OUTSIDE the
          GestureHandlerRootView in App.tsx and would never see a pan. It needs
          its own root. */}
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.scrim, { opacity: slide }]}>
          <Pressable
            style={styles.fill}
            onPress={() => {
              if (!disableDrag) onClose();
            }}
          />
        </Animated.View>

        <View style={styles.dock} pointerEvents="box-none">
          <Animated.View
            onLayout={(e) => {
              if (snapped) return;
              const h = e.nativeEvent.layout.height;
              if (h > 0 && Math.abs(h - sheetH) > 1) setSheetH(h);
            }}
            style={[
              styles.sheet,
              snapped ? { height: winH } : { maxHeight: winH * 0.9 },
              { borderColor: s.border, transform: [{ translateY }] },
            ]}>
            <LinearGradient
              colors={s.colors as unknown as readonly [string, string, ...string[]]}
              locations={[0, 0.6, 1]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <PanGestureHandler
              onGestureEvent={onGesture}
              onHandlerStateChange={onGestureState}
              enabled={!disableDrag}>
              <View style={styles.grabBay}>
                <View style={[styles.handle, { backgroundColor: s.handle }]} />
              </View>
            </PanGestureHandler>

            {!disableDrag && !hideClose && (
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBay}>
                <View style={[styles.close, { backgroundColor: s.closeBg, borderColor: s.closeLine }]}>
                  <Svg width={12} height={12} viewBox="0 0 12 12">
                    <Path
                      d="M2 2L10 10M10 2L2 10"
                      stroke={s.closeInk}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      fill="none"
                    />
                  </Svg>
                </View>
              </Pressable>
            )}

            {body}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(23,19,17,0.5)",
  },
  dock: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
    elevation: 24,
    shadowColor: "#301A60",
    shadowOpacity: 0.4,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -12 },
  },
  grabBay: { paddingTop: 10, paddingBottom: 8, alignItems: "center" },
  handle: { width: 40, height: 4, borderRadius: 2 },
  closeBay: { position: "absolute", top: 10, right: 14, zIndex: 5 },
  close: {
    height: 32,
    width: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bodyHug: { flexGrow: 0 },
  bodyFill: { flex: 1 },
});
