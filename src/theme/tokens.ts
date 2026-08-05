/**
 * tokens.ts — the Menoid purple palette + sky gradients.
 *
 * Ported from the extension's tailwind.config.js / style.css. Everything opens
 * on the SAME violet sky: deep-violet ink on pale lilac. (Noid/dark mode exists
 * in the palette for later, but this milestone only uses the open sky.)
 */

export const COLORS = {
  violetDeep: "#4E2F8E",
  violetDark: "#7F63C7",
  violet: "#8D6DCC",
  violetMid: "#AE8FE2",
  violetSoft: "#C3B1F1",
  lilac: "#D9BEF4",
  lilacPale: "#EDC8FD",
  creamViolet: "#F0E9FE",
  white: "#FFFFFF",

  // status / meter tints tuned to read on the lilac sky
  rose: "#FF9FBE",
  coral: "#FFB48C",
  sand: "#FFDD8F",
  leaf: "#B9F0A5",
  mint: "#8DF0CE",
  errorInk: "#9E1F55",
} as const;

/** Registered by useAppFonts(); falls back to system if not yet loaded. */
export const FONT = {
  round: "Fredoka_500Medium",
  roundSemi: "Fredoka_600SemiBold",
  roundBold: "Fredoka_700Bold",
  body: "PlusJakartaSans_500Medium",
  bodySemi: "PlusJakartaSans_600SemiBold",
  mono: "monospace",
} as const;

/** rgba() helper: rgba("78,47,142", 0.5) → "rgba(78,47,142,0.5)". */
export function rgba(triple: string, a: number) {
  return `rgba(${triple},${a})`;
}

export const INK_RGB = "78,47,142"; // violetDeep as an rgb triple

/** The 225° lilac→violet diagonal wash (the open sky). */
export const SKY_OPEN = {
  colors: ["#D9BEF4", "#B197E9", "#9A7FDD"] as const,
  locations: [0, 0.48, 1] as const,
  base: "#B197E9", // flat mid-tone (splash / one-frame fallback)
};

export const SKY_NOID = {
  colors: ["#4B2E86", "#33205E", "#1D1140"] as const,
  locations: [0, 0.46, 1] as const,
  base: "#33205E",
};
