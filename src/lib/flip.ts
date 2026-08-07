/**
 * flip.ts — shared-element (FLIP) transitions between two measured rects.
 *
 * The coin page grows out of the treasure card and shrinks back into it, and
 * the tapped token's crest flies into the page header. Both are the same trick:
 * measure where the element WAS, measure where it now IS, start it transformed
 * so it looks unmoved, then animate the transform away.
 *
 * ONE THING IS DIFFERENT FROM THE WEB VERSION and it is the thing that will
 * silently ruin the effect if you forget it: the extension set
 * `transform-origin: top left` and scaled about the corner. React Native has no
 * transform-origin — a `scale` is always about the view's CENTRE. So the offset
 * here is computed between CENTRES, not between top-left corners. Use corner
 * deltas with centre scaling and the element lands visibly off-target, by half
 * the size difference in each axis.
 */

import { Animated, Easing } from "react-native";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlipTransform {
  translateX: Animated.AnimatedInterpolation<number>;
  translateY: Animated.AnimatedInterpolation<number>;
  scaleX: Animated.AnimatedInterpolation<number>;
  scaleY: Animated.AnimatedInterpolation<number>;
}

/**
 * Build the transform list for a FLIP driven by `progress`, where 0 = sitting
 * exactly on top of `from` and 1 = resting at its own layout position.
 */
export function flipTransform(
  progress: Animated.Value,
  from: Rect,
  to: Rect
): FlipTransform | null {
  if (!from.width || !from.height || !to.width || !to.height) return null;

  const dx = from.x + from.width / 2 - (to.x + to.width / 2);
  const dy = from.y + from.height / 2 - (to.y + to.height / 2);
  const sx = from.width / to.width;
  const sy = from.height / to.height;

  const at = (a: number, b: number) =>
    progress.interpolate({ inputRange: [0, 1], outputRange: [a, b] });

  return {
    translateX: at(dx, 0),
    translateY: at(dy, 0),
    scaleX: at(sx, 1),
    scaleY: at(sy, 1),
  };
}

/** The card's glide. A whisper of overshoot — enough to feel alive, not springy. */
export const FLIP_CARD_EASING = Easing.bezier(0.33, 1.12, 0.5, 1);
/** The crest's flight. A clean ease-out; it was overshooting far too hard. */
export const FLIP_ICON_EASING = Easing.bezier(0.22, 1, 0.36, 1);

export const FLIP_CARD_MS = 620;
export const FLIP_ICON_MS = 500;

/** Measure a view in window coordinates. Resolves null if it is not laid out. */
export function measureRect(
  ref: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null
): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!ref) return resolve(null);
    let settled = false;
    // measureInWindow's callback can simply never fire for an unmounted or
    // zero-size view, and a morph that waits forever is a screen that never
    // opens. One frame is plenty for a view that is already on screen.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 120);
    ref.measureInWindow((x, y, width, height) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(width && height ? { x, y, width, height } : null);
    });
  });
}
