/**
 * LiquidSheet.tsx — the bottom sheet every action modal in the wallet sits in.
 *
 * Ported from the extension's shared/LiquidSheet.tsx, with its fullscreen mode
 * deliberately dropped: on a phone a sheet that snaps to fullscreen is just a
 * screen, and the brief here is a sheet that comes up from the bottom and is
 * only as tall as its content (capped at 90% so it can never swallow the app).
 *
 * WHY THE DRAG IS A GESTURE-HANDLER PAN AND NOT A PanResponder:
 * PanResponder delivers every touch move to JS, so a drag competes with
 * whatever else React is doing — on the send form, that is a live-validating
 * input. `PanGestureHandler` feeds `Animated.event(..., {useNativeDriver:true})`
 * from the native side instead, so the sheet tracks the finger on the UI thread
 * and JS only hears about the release. That is the whole difference between a
 * sheet that sticks to your thumb and one that lags behind it.
 *
 * The sheet is measured, not guessed: `onLayout` reports its real height and
 * the entrance interpolates from exactly that far down, so a short sheet does
 * not fly in from the bottom of the screen and a tall one does not start
 * halfway up.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
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
    tail: "#DCCDF7",
  },
  ink: {
    colors: ["#2B1A55", "#221244", "#1A1030"] as const,
    border: "rgba(244,238,255,0.14)",
    handle: "rgba(244,238,255,0.3)",
    closeBg: "rgba(244,238,255,0.08)",
    closeLine: "rgba(244,238,255,0.16)",
    closeInk: "rgba(244,238,255,0.75)",
    tail: "#1A1030",
  },
};

export default memo(function LiquidSheet({
  open,
  onClose,
  tone = "cream",
  disableDrag = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  tone?: SheetTone;
  /** Kills every dismissal path — used while a transaction is in flight. */
  disableDrag?: boolean;
  children: React.ReactNode;
}) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const s = SURFACE[tone];

  const [mounted, setMounted] = useState(open);
  /* Seeded to the full window height so the very first frame is off-screen even
     before onLayout has run — otherwise the sheet paints in place for one frame
     and then jumps down to animate up, which reads as a flash. */
  const [sheetH, setSheetH] = useState(winH);

  const slide = useRef(new Animated.Value(0)).current; // 0 = away, 1 = seated
  const dragRaw = useRef(new Animated.Value(0)).current;

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

  /* The pan lives on the grab area only — dragging anywhere else would fight
     the form's inputs and the content scroll. `Animated.event` feeds the value
     from the native side, so the sheet tracks the thumb without waking JS; the
     only hop is the release decision below. */
  const onGesture = useMemo(
    () => Animated.event([{ nativeEvent: { translationY: dragRaw } }], { useNativeDriver: true }),
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

  const translateY = Animated.add(
    slide.interpolate({ inputRange: [0, 1], outputRange: [sheetH, 0] }),
    drag
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

        <KeyboardAvoidingView
          style={styles.dock}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none">
          <Animated.View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && Math.abs(h - sheetH) > 1) setSheetH(h);
            }}
            style={[
              styles.sheet,
              {
                maxHeight: winH * 0.9,
                borderColor: s.border,
                transform: [{ translateY }],
              },
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

            {!disableDrag && (
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

            <ScrollView
              style={styles.body}
              contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}>
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
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
  body: { flexGrow: 0 },
});
