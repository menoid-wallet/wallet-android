/**
 * MenoidWordmark.tsx — the hand-drawn monoline "menoid" wordmark.
 * Glyph geometry ported verbatim from the extension (must not drift).
 *   tone "light"  → for purple backgrounds
 *   tone "violet" → for pale cloud surfaces
 */
import React from "react";
import Svg, { Defs, LinearGradient, Stop, G, Path, Circle } from "react-native-svg";

let counter = 0;

function MenoidWordmarkBase({
  width,
  height,
  tone = "light",
}: {
  width?: number;
  height?: number;
  tone?: "light" | "violet";
}) {
  const id = React.useMemo(() => `wm${counter++}`, []);
  const w = width ?? (height ? height * (1392 / 310) : 90);
  const h = height ?? w * (310 / 1392);

  const stops: [string, string][] =
    tone === "light"
      ? [["0", "#f0e9fe"], ["0.48", "#d6c8f7"], ["1", "#c3b1f1"]]
      : [["0", "#9576dd"], ["0.48", "#7757c4"], ["1", "#5f41ad"]];

  return (
    <Svg width={w} height={h} viewBox="-6 -104 1392 310">
      <Defs>
        <LinearGradient id={id} x1="0" y1="-115" x2="0" y2="205" gradientUnits="userSpaceOnUse">
          {stops.map(([offset, color], i) => (
            <Stop key={i} offset={offset} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <G fill="none" stroke={`url(#${id})`} strokeWidth={60} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M 30 170 V 100 A 67.5 70 0 0 1 165 100 V 170 M 165 100 A 67.5 70 0 0 1 300 100 V 170" />
        <G transform="translate(368 0)">
          <Path strokeWidth={56} d="M 158 90 C 157.5 81, 159.4 57.6, 150.9 49.1 A 72 72 0 1 0 145.3 156" />
          <Path strokeWidth={44} d="M 36 96 H 158" />
        </G>
        <Path transform="translate(606 0)" d="M 30 170 V 100 A 70 70 0 0 1 170 100 V 170" />
        <Path transform="translate(844 0)" d="M 100 30 A 70 70 0 0 1 100 170 A 70 70 0 0 1 100 30" />
        <Path transform="translate(1082 0)" d="M 30 170 V 30" />
        <Path transform="translate(1180 0)" d="M 100 30 A 70 70 0 0 1 100 170 A 70 70 0 0 1 100 30 M 170 -66 V 170" />
      </G>
      <G transform="translate(1082 0)">
        <Circle cx="30" cy="-66" r="32" fill={`url(#${id})`} />
        <Circle cx="22" cy="-74" r="8.5" fill="#fff" opacity={0.55} />
      </G>
    </Svg>
  );
}

export default React.memo(MenoidWordmarkBase);
