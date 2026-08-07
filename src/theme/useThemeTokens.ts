/**
 * useThemeTokens — the palette swap between the two modes.
 *
 * Ported from the extension's lib/useThemeTokens.ts. The extension shipped
 * BOTH prebuilt Tailwind class strings and raw values; only the raw values
 * survive the port, because RN has no class names — every colour is an inline
 * style here, which is exactly what the raw half of that table existed for.
 *
 * Both modes are the same violet sky; noid is that sky after dark. So the swap
 * is NOT "light theme / dark theme" in the usual sense — open runs violet ink on
 * pale lilac, noid runs near-white ink on deep violet, and the accent stays in
 * the same hue family on both sides. That is what makes the mode switch read as
 * the weather changing rather than as two different apps.
 */

export interface ThemeTokens {
  isNoid: boolean;
  /** The ink: what type is set in on this mode's sky */
  ink: string;
  /** The ink as an "r,g,b" triple, for building rgba() at a call site */
  inkRgb: string;
  /** The accent — deep violet in the light, lilac in the dark */
  accent: string;
  accentRgb: string;
  /** Glass over this mode's sky */
  glass: string;
  glassLine: string;
  /** Price movement, tuned to stay legible on each sky */
  up: string;
  down: string;
}

const OPEN: Omit<ThemeTokens, "isNoid"> = {
  ink: "#4E2F8E",
  inkRgb: "78,47,142",
  accent: "#7B55C9",
  accentRgb: "123,85,201",
  glass: "rgba(255,255,255,0.45)",
  glassLine: "rgba(255,255,255,0.62)",
  up: "#1F7A55",
  down: "#B2382A",
};

const NOID: Omit<ThemeTokens, "isNoid"> = {
  ink: "#F4EEFF",
  inkRgb: "244,238,255",
  accent: "#C9B0FF",
  accentRgb: "201,176,255",
  glass: "rgba(255,255,255,0.10)",
  glassLine: "rgba(255,255,255,0.18)",
  up: "#6EE7A8",
  down: "#FF8E86",
};

export function themeTokens(isNoid: boolean): ThemeTokens {
  return { isNoid, ...(isNoid ? NOID : OPEN) };
}

/** rgba() from a token triple: rgba(t.inkRgb, 0.6) → "rgba(78,47,142,0.6)". */
export function rgba(triple: string, a: number): string {
  return `rgba(${triple},${a})`;
}

/**
 * The header wash — opaque at the top, gone by the bottom, so content scrolls
 * up into the sky instead of under a hard edge. RN cannot blur behind a view
 * (no backdrop-filter), so the gradient carries slightly more weight than the
 * extension's does to keep the brand row legible over a passing token bar.
 */
export const HEADER_WASH = {
  open: ["rgba(196,173,240,0.86)", "rgba(196,173,240,0.46)", "rgba(196,173,240,0)"] as const,
  noid: ["rgba(29,17,64,0.9)", "rgba(29,17,64,0.5)", "rgba(29,17,64,0)"] as const,
  locations: [0, 0.7, 1] as const,
};

/** The treasure card's body — the one solid object on a page made of sky. */
export const TREASURE_GRADIENT = {
  open: ["#6247A8", "#3D2673", "#2B1A55"] as const,
  noid: ["#F4EEFF", "#DCCEFA", "#C9B0FF"] as const,
  locations: [0, 0.58, 1] as const,
};
