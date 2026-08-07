/**
 * AnimatedLogo.tsx — the Menoid mark, alive and cheap.
 *
 * PERFORMANCE NOTE (this is the whole design):
 * The eyes are plain <View>s, not SVG. React Native's `scaleY` transform scales
 * a view about its OWN centre, which is exactly the blink we want, and — unlike
 * SVG geometry props — a transform can run on the NATIVE driver. The previous
 * version animated <Rect y/height> with useNativeDriver:false, so every frame
 * of every blink crossed into JS and re-rendered the SVG tree, on every screen,
 * forever. That was the single biggest source of the app's jank.
 *
 * Only the smile is still SVG, and it is static and memoised, so it rasterises
 * once and never re-renders.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Image, Text, View, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, Ellipse, LinearGradient as SvgGradient, Stop, Path } from "react-native-svg";
import { FONT } from "../../theme/tokens";

const blank = require("../../../assets/brand/menoid-logo-blank.png");

/* Eye geometry as fractions of the mark, converted from the artwork's 1024
   unit space (x 295.1 / 641.8, y 323.6, w 85.3, h 177.8, r 42.7). */
const EYE = {
  y: 323.6 / 1024,
  w: 85.3 / 1024,
  h: 177.8 / 1024,
  r: 42.7 / 1024,
  leftX: 295.1 / 1024,
  rightX: 641.8 / 1024,
  underlayDx: -2.7 / 1024, // the white edge peeking out on the left
};

const IRIS = ["#4d30af", "#7b5add", "#8260e4", "#7d58df"] as const;
const IRIS_STOPS = [0, 0.1, 0.3, 0.9] as const;

/** Anything that can drive a numeric transform: a value, a composition of them. */
type AnimNum = Animated.Value | Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication<number>;

const Eye = memo(function Eye({
  size,
  x,
  lid,
  aim,
}: {
  size: number;
  x: number;
  /** eye openness, 0..1 — a value or any composition of them */
  lid: AnimNum;
  /** where the eye is looking, in px from its resting socket */
  aim: { x: AnimNum; y: AnimNum };
}) {
  const w = size * EYE.w;
  const h = size * EYE.h;
  const r = size * EYE.r;
  const top = size * EYE.y;
  const box: ViewStyle = { position: "absolute", top, width: w, height: h, borderRadius: r };
  return (
    <>
      {/* white underlay, a hair to the left */}
      <Animated.View
        style={[
          box,
          {
            left: size * (x + EYE.underlayDx),
            backgroundColor: "#ffffff",
            transform: [{ translateX: aim.x }, { translateY: aim.y }, { scaleY: lid }],
          },
        ]}
      />
      <Animated.View
        style={[
          box,
          {
            left: size * x,
            overflow: "hidden",
            transform: [{ translateX: aim.x }, { translateY: aim.y }, { scaleY: lid }],
          },
        ]}>
        <LinearGradient
          colors={IRIS as unknown as readonly [string, string, ...string[]]}
          locations={IRIS_STOPS as unknown as readonly [number, number, ...number[]]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </>
  );
});

/** The smile — static, so it is drawn once and never re-rendered. */
const Smile = memo(function Smile() {
  return (
    <Svg viewBox="0 0 1024 1024" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <SvgGradient id="al-smile" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#704bbd" />
          <Stop offset="1" stopColor="#956ff1" />
        </SvgGradient>
      </Defs>
      <Path d="M 446.2 520 Q 510.2 580.4 574.2 520" fill="none" stroke="#ffffff" strokeWidth={39.1} strokeLinecap="round" />
      <Path d="M 446.2 517.3 Q 510.2 577.8 574.2 517.3" fill="none" stroke="url(#al-smile)" strokeWidth={39.1} strokeLinecap="round" />
    </Svg>
  );
});

/** The sleeping mouth — a small snore "o" where the smile normally is. */
const Snore = memo(function Snore() {
  return (
    <Svg viewBox="0 0 1024 1024" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <SvgGradient id="al-snore" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#704bbd" />
          <Stop offset="1" stopColor="#956ff1" />
        </SvgGradient>
      </Defs>
      <Ellipse cx={510} cy={548} rx={30} ry={23} fill="url(#al-snore)" />
      <Ellipse cx={500} cy={540} rx={9} ry={6} fill="#ffffff" opacity={0.4} />
    </Svg>
  );
});

/** Three z's drifting up and to the right of the head while it sleeps. */
const Zzz = memo(function Zzz({ size }: { size: number }) {
  const drift = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    const loops = drift.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 550),
          Animated.timing(v, { toValue: 1, duration: 1650, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [drift]);

  const specs = [
    { x: 0.674, y: 0.26, fs: 0.068 },
    { x: 0.73, y: 0.2, fs: 0.051 },
    { x: 0.773, y: 0.155, fs: 0.037 },
  ];

  return (
    <>
      {specs.map((s, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: size * s.x,
            top: size * s.y,
            opacity: drift[i].interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: drift[i].interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.12] }) },
              { translateX: drift[i].interpolate({ inputRange: [0, 1], outputRange: [0, size * 0.05] }) },
            ],
          }}>
          <Text
            style={{
              fontFamily: FONT.roundBold,
              fontSize: size * s.fs,
              color: "#7b5add",
              includeFontPadding: false,
            }}>
            z
          </Text>
        </Animated.View>
      ))}
    </>
  );
});

/**
 * The mark's face.
 *
 *   idle     — neutral: a gentle double-blink, optional gaze tracking
 *   sleeping — eyes shut, floating, snoring, z's drifting up
 *   awake    — just woke: eyes pop open with a startle
 *   waiting  — eyes open, scanning side to side (watching the voyage cloud)
 *   wink     — the "confirmed!" beat: one eye winks fast, the other holds still
 */
export type LogoExpression = "idle" | "sleeping" | "awake" | "waiting" | "wink";

export type GazePoint = { x: number; y: number };

function AnimatedLogoBase({
  size = 120,
  style,
  blink = true,
  float = false,
  gaze = null,
  expression = "idle",
}: {
  size?: number;
  style?: ViewStyle;
  blink?: boolean;
  float?: boolean;
  /** A point in WINDOW coordinates for the eyes to follow. */
  gaze?: GazePoint | null;
  expression?: LogoExpression;
}) {
  const sleeping = expression === "sleeping";
  const waiting = expression === "waiting";
  const winking = expression === "wink";
  const floating = float || sleeping;
  /* The lid only drops for a BLINK. Sleep is a separate, held-shut value, so
     the two can cross-fade rather than fight over one animated node — which is
     what makes waking read as the eyes springing open. */
  const blinkingNow = blink && (expression === "idle" || expression === "awake");

  const lid = useRef(new Animated.Value(1)).current;
  const shut = useRef(new Animated.Value(sleeping ? 0.07 : 1)).current;
  const wink = useRef(new Animated.Value(1)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const aimL = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const aimR = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const hostRef = useRef<View | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const measure = useCallback(() => {
    hostRef.current?.measureInWindow((x, y, w, h) => {
      if (w || h) origin.current = { x, y };
    });
  }, []);

  /* Each eye is aimed from ITS OWN socket, which is what makes the pair
     converge on something between them and run parallel for something far off
     to one side — the same geometry as the extension's mark. */
  useEffect(() => {
    const travelX = size * (66 / 1024);
    const travelY = size * (40 / 1024);
    const reach = size * 1.7;

    const solve = (xFrac: number) => {
      const o = origin.current;
      if (!o || !gaze) return { x: 0, y: 0 };
      const cx = o.x + size * (xFrac + EYE.w / 2);
      const cy = o.y + size * (EYE.y + EYE.h / 2);
      const dx = gaze.x - cx;
      const dy = gaze.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return { x: 0, y: 0 };
      const k = Math.min(1, dist / reach);
      return { x: (dx / dist) * k * travelX, y: (dy / dist) * k * travelY };
    };

    const l = solve(EYE.leftX);
    const r = solve(EYE.rightX);
    Animated.parallel([
      Animated.timing(aimL, { toValue: l, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(aimR, { toValue: r, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [gaze?.x, gaze?.y, size, aimL, aimR]);

  useEffect(() => {
    if (!blinkingNow) {
      lid.setValue(1);
      return;
    }
    // The website's double-blink, entirely on the UI thread.
    const t = (to: number, ms: number) =>
      Animated.timing(lid, {
        toValue: to,
        duration: ms,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      });
    const loop = Animated.loop(
      Animated.sequence([t(0.07, 90), t(1, 100), t(0.07, 90), t(1, 100), Animated.delay(2800)])
    );
    loop.start();
    return () => loop.stop();
  }, [blinkingNow, lid]);

  /* Sleep is a spring rather than a cut, so dozing off lowers the lids and
     waking pops them open with a little overshoot. */
  useEffect(() => {
    Animated.spring(shut, {
      toValue: sleeping ? 0.07 : 1,
      speed: 11,
      bounciness: sleeping ? 0 : 14,
      useNativeDriver: true,
    }).start();
  }, [sleeping, shut]);

  /* The wink: one fast shut-and-open on the viewer's-left eye only. Its partner
     holds perfectly still, which is what separates a wink from a blink. */
  useEffect(() => {
    if (!winking) {
      wink.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wink, { toValue: 0.06, duration: 110, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(wink, { toValue: 1, duration: 150, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
        Animated.delay(1500),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [winking, wink]);

  /* Watching the voyage cloud: the eyes sweep side to side on the SAME 2.4s
     period as CloudVoyage's drift, so the mark reads as tracking it. */
  useEffect(() => {
    if (!waiting) {
      scan.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(scan, { toValue: -1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    scan.setValue(-1);
    loop.start();
    return () => loop.stop();
  }, [waiting, scan]);

  useEffect(() => {
    if (!floating) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [floating, bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.05] });

  // Blink × sleep multiply into one openness, so a blink still reads while the
  // lids are on their way down and neither animation has to know about the other.
  const openness = Animated.multiply(lid, shut);
  const leftOpen = winking ? Animated.multiply(wink, shut) : openness;
  const rightOpen = winking ? shut : openness;

  /* While waiting, BOTH eyes share one sweep instead of aiming individually —
     they are following the same cloud, so they must not converge. Built once
     per size, never per render: a fresh Animated node every render is a fresh
     native node every render. */
  const scanAim = useMemo(
    () => ({
      x: scan.interpolate({
        inputRange: [-1, 1],
        outputRange: [-size * (34 / 1024), size * (34 / 1024)],
      }),
      y: new Animated.Value(size * (16 / 1024)),
    }),
    [scan, size]
  );

  const aimLeft = waiting ? scanAim : aimL;
  const aimRight = waiting ? scanAim : aimR;

  return (
    <Animated.View
      ref={hostRef}
      onLayout={measure}
      collapsable={false}
      style={[{ width: size, height: size, transform: [{ translateY }] }, style]}>
      <Image source={blank} style={{ width: size, height: size }} resizeMode="contain" fadeDuration={0} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Eye size={size} x={EYE.leftX} lid={leftOpen} aim={aimLeft} />
        <Eye size={size} x={EYE.rightX} lid={rightOpen} aim={aimRight} />
        {sleeping ? <Snore /> : <Smile />}
      </View>
      {sleeping && <Zzz size={size} />}
    </Animated.View>
  );
}

export default memo(AnimatedLogoBase);
