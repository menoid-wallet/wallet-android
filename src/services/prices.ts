/**
 * prices.ts — live market data for the wallet.
 *
 * Ported verbatim from the extension's services/prices.ts (it was already plain
 * `fetch`, so nothing had to change for React Native).
 *
 * Every supported chain runs on a *testnet*, so the on-chain amounts are real
 * but carry no market value. To value them we map each testnet to its mainnet
 * counterpart and pull live USD prices from CoinGecko's public API:
 *
 *   monad → monad, sepolia → ethereum, base_sepolia → ethereum,
 *   solana → solana, sui → sui, aptos → aptos
 *
 * The cache lives at module scope and in-flight calls are shared, so however
 * many views poll, the rate-limited free tier sees one request per TTL window.
 */

import type { NetworkId } from "../lib/networks";

const API = "https://api.coingecko.com/api/v3";

/** testnet network → mainnet CoinGecko coin id */
export const COINGECKO_IDS: Record<NetworkId, string> = {
  monad: "monad",
  sepolia: "ethereum",
  base_sepolia: "ethereum",
  solana: "solana",
  sui: "sui",
  aptos: "aptos",
};

export interface PriceInfo {
  /** spot price in USD */
  usd: number;
  /** 24h change, percent */
  change24h: number;
}

export type PriceMap = Record<NetworkId, PriceInfo>;

const EMPTY_PRICE: PriceInfo = { usd: 0, change24h: 0 };

const PRICE_TTL = 45_000;
let priceCache: { at: number; data: PriceMap } | null = null;
let priceInflight: Promise<PriceMap> | null = null;

/**
 * Live USD price + 24h change for every supported chain, in one request.
 * Cached for `PRICE_TTL`; concurrent callers share the in-flight promise.
 */
export async function fetchAllPrices(): Promise<PriceMap> {
  const now = Date.now();
  if (priceCache && now - priceCache.at < PRICE_TTL) return priceCache.data;
  if (priceInflight) return priceInflight;

  priceInflight = (async () => {
    const ids = Array.from(new Set(Object.values(COINGECKO_IDS))).join(",");
    const res = await fetch(
      `${API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
    );
    if (!res.ok) throw new Error(`price fetch failed (${res.status})`);
    const json = await res.json();

    const data = {} as PriceMap;
    for (const net of Object.keys(COINGECKO_IDS) as NetworkId[]) {
      const cg = json[COINGECKO_IDS[net]];
      data[net] = cg
        ? { usd: Number(cg.usd) || 0, change24h: Number(cg.usd_24h_change) || 0 }
        : { ...EMPTY_PRICE };
    }
    priceCache = { at: Date.now(), data };
    return data;
  })();

  try {
    return await priceInflight;
  } finally {
    priceInflight = null;
  }
}

/** Last successfully fetched prices, if any (no network call). */
export function getCachedPrices(): PriceMap | null {
  return priceCache?.data ?? null;
}

// ─── Chart cache ────────────────────────────────────────────────────────────

export type ChartRange = "1" | "7" | "30" | "365";

const CHART_TTL = 120_000;
const chartCache: Record<string, { at: number; points: number[] }> = {};
const chartInflight: Record<string, Promise<number[]>> = {};

/** Reduce a dense price series down to ~`target` evenly-spaced points. */
function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const step = arr.length / target;
  const out: number[] = [];
  for (let i = 0; i < target; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

/**
 * Historical USD price series for one chain's mainnet token, oldest → newest.
 *
 * Downsampled to 56 points before it ever reaches the chart. That is not a
 * cosmetic choice: the curve is drawn as one SVG path, and a path built from
 * CoinGecko's raw 5-minute series is thousands of segments the GPU has to
 * re-tessellate on every frame of the draw-in animation.
 */
export async function fetchChart(
  network: NetworkId,
  range: ChartRange = "7"
): Promise<number[]> {
  const id = COINGECKO_IDS[network];
  const key = `${id}:${range}`;
  const now = Date.now();

  const cached = chartCache[key];
  if (cached && now - cached.at < CHART_TTL) return cached.points;
  const inflight = chartInflight[key];
  if (inflight) return inflight;

  chartInflight[key] = (async () => {
    // No `interval` param — that's enterprise-gated on the free tier and would
    // 401. CoinGecko picks the granularity from `days`; we downsample.
    const res = await fetch(`${API}/coins/${id}/market_chart?vs_currency=usd&days=${range}`);
    if (!res.ok) throw new Error(`chart fetch failed (${res.status})`);
    const json = await res.json();
    const raw: number[] = Array.isArray(json?.prices)
      ? json.prices.map((p: [number, number]) => p[1]).filter((n: number) => Number.isFinite(n))
      : [];
    const points = downsample(raw, 56);
    chartCache[key] = { at: Date.now(), points };
    return points;
  })();

  try {
    return await chartInflight[key];
  } finally {
    delete chartInflight[key];
  }
}

/** Last successfully fetched series for this chain+range, if any. */
export function getCachedChart(network: NetworkId, range: ChartRange): number[] | null {
  return chartCache[`${COINGECKO_IDS[network]}:${range}`]?.points ?? null;
}
