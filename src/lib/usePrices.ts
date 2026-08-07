/**
 * usePrices.ts — React bindings over services/prices.
 *
 * Ported from the extension's components/shared/usePrices.ts. The only change
 * is the "is anyone looking?" test: the extension skipped a poll when
 * `document.hidden`, which has no meaning here, so this asks AppState instead —
 * a backgrounded app must not keep pinging CoinGecko.
 *
 * The module-level cache in services/prices means every hook instance collapses
 * into one network request per TTL window, and a remount paints instantly from
 * the cache instead of flashing "—".
 */

import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  fetchAllPrices,
  fetchChart,
  getCachedChart,
  getCachedPrices,
  type ChartRange,
  type PriceMap,
} from "../services/prices";
import type { NetworkId } from "./networks";

export function useTokenPrices(pollMs = 60_000) {
  const [prices, setPrices] = useState<PriceMap | null>(() => getCachedPrices());
  const [loading, setLoading] = useState(!getCachedPrices());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const p = await fetchAllPrices();
        if (alive) {
          setPrices(p);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => {
      if (AppState.currentState === "active") void load();
    }, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return { prices, loading };
}

/**
 * Historical price series for one chain + range.
 *
 * Keeps the PREVIOUS series on screen until the new one lands, so switching
 * range never flashes an empty card — the chart just redraws. Seeded from the
 * module cache for the same reason the price hook is.
 */
export function useTokenChart(network: NetworkId, range: ChartRange) {
  const [points, setPoints] = useState<number[] | null>(() => getCachedChart(network, range));
  const [loading, setLoading] = useState(() => getCachedChart(network, range) == null);
  const reqRef = useRef(0);

  useEffect(() => {
    const req = ++reqRef.current;
    const cached = getCachedChart(network, range);
    if (cached) setPoints(cached);
    setLoading(cached == null);
    fetchChart(network, range)
      .then((p) => {
        if (reqRef.current !== req) return;
        setPoints(p);
        setLoading(false);
      })
      .catch(() => {
        if (reqRef.current !== req) return;
        setLoading(false);
      });
  }, [network, range]);

  return { points, loading };
}
