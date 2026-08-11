/**
 * feedback.ts — the in-wallet survey, ported from the extension.
 *
 * Field names mirror the backend's Feedback model exactly; renaming anything
 * here silently drops that answer, since the server takes what it recognises.
 *
 *   POST /feedback/create → one submission
 */

import { BASE_URL } from "./api";

export type ThemeFeel = "loved" | "liked" | "neutral" | "disliked";
export type Recommend = "definitely" | "probably" | "maybe" | "probably_not" | "no";
export type BuildNext =
  | "private_swaps"
  | "private_prediction_markets"
  | "private_memecoin_launchpad"
  | "private_dapps"
  | "more_chains"
  | "ai_assistant";

export interface FeedbackPayload {
  setupEase?: number;
  uiUxRating?: number;
  noidRating?: number;
  /** the backend still calls the theme question `pirateTheme` */
  pirateTheme?: ThemeFeel;
  confusing?: string;
  buildNext?: BuildNext[];
  primaryWalletNps?: number;
  improve?: string;
  recommend?: Recommend;
  additional?: string;
  email: string;
  discord?: string;
  twitter?: string;
  walletAddress?: string;
  mode?: "open" | "noid";
}

export async function submitFeedback(payload: FeedbackPayload): Promise<{ _id: string }> {
  const res = await fetch(`${BASE_URL}/feedback/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error ?? `Couldn't send feedback (${res.status}).`);
  }
  return res.json();
}
