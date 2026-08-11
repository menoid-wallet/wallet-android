/**
 * feedback.ts — remembers that this wallet already had its say.
 *
 * Asking someone the same ten questions every time they open settings is how a
 * survey stops being answered, so a submission is recorded locally and the form
 * reopens in its thank-you state instead.
 *
 * LOCAL ONLY, and deliberately so: it is a "don't nag me again" flag, not a
 * record of what was said. The answers live on the backend.
 */

import { getItem, setItem } from "./storage";

export const FEEDBACK_KEY = "menoid_feedback_v1";

export interface FeedbackRecord {
  submitted: boolean;
  /** epoch ms */
  at: number;
  /** shown back in the thank-you state */
  email: string;
}

export async function getFeedbackRecord(): Promise<FeedbackRecord | null> {
  try {
    const rec = await getItem<FeedbackRecord>(FEEDBACK_KEY);
    return rec && rec.submitted ? rec : null;
  } catch {
    return null;
  }
}

export async function markFeedbackSubmitted(email: string): Promise<void> {
  try {
    await setItem(FEEDBACK_KEY, { submitted: true, at: Date.now(), email });
  } catch {
    /* a lost flag only means the form asks again — never block the submission */
  }
}
