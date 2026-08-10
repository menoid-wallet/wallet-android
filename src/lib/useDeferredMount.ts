/**
 * useDeferredMount — "render this AFTER the navigation has started moving".
 *
 * THE PROBLEM THIS EXISTS FOR, because it caused the app's worst stutters:
 * every screen here is mounted in the same React commit as the touch that asks
 * for it, and the slide that reveals it can only start on the frame AFTER that
 * commit lands. So the heavier the destination, the longer the gap between the
 * tap and any motion — which does not read as "slow animation", it reads as the
 * button not working, and then the screen jumping. Opening a coin page had to
 * build a price chart and a whole transaction list before the pager could move.
 *
 * So the destination mounts as a cheap shell and its expensive parts arrive a
 * frame or two later, while the slide is already running. The total work is
 * identical; it just stops all landing in the frame that owes us an animation.
 *
 * REQUESTANIMATIONFRAME, NOT SETTIMEOUT(0): a timeout can be serviced within
 * the same frame and buys nothing. Chaining rAF guarantees at least one painted
 * frame in between, which is the entire point.
 *
 * Reserve space for whatever is deferred, or the content will jump as it lands.
 */

import { useEffect, useState } from "react";

export function useDeferredMount(frames = 1): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    let handle = 0;
    let left = Math.max(1, frames);

    const step = () => {
      if (!live) return;
      if (--left <= 0) return setReady(true);
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);

    return () => {
      live = false;
      cancelAnimationFrame(handle);
    };
  }, [frames]);

  return ready;
}
