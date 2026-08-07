/**
 * chains.tsx — per-chain PRESENTATION metadata (name, symbol, colour, glyph).
 *
 * Ported from the extension's lib/chains.tsx. The glyph paths are verbatim, so
 * the six crests are pixel-identical to the extension's; only the wrapper is
 * react-native-svg instead of DOM SVG.
 *
 * In the extension a glyph was a ReactNode that inherited `currentColor` and
 * `h-full w-full` from its container. RN has no colour inheritance and no
 * percentage sizing, so a glyph is a COMPONENT here: `<chain.Icon size color/>`.
 *
 * The 1.18 zoom four of them carry has to be applied ABOUT THE CENTRE. In the
 * extension it was a CSS transform on the <svg> box, and CSS transforms on a
 * replaced element default to a 50%/50% origin. An SVG `transform="scale(1.18)"`
 * does NOT: it scales about the user-space origin, which shoves every glyph down
 * and to the right until it falls out of its own viewBox — visibly cropping the
 * crests. Hence the translate/scale/translate sandwich.
 *
 * Network plumbing (RPC, chainId, pool addresses) lives in ./networks.
 * Market-data mapping (CoinGecko ids) lives in ../services/prices.
 */

import React from "react";
import Svg, { Path, G } from "react-native-svg";
import type { NetworkId } from "./networks";

export interface ChainIconProps {
  size: number;
  color: string;
}

export interface ChainMeta {
  id: NetworkId;
  name: string;
  /** small lowercase tag under the name, e.g. "testnet" */
  subtitle: string;
  /** native token ticker, e.g. "MON" */
  symbol: string;
  /** brand colour as an rgb() string, used for the chart accent */
  color: string;
  Icon: React.FC<ChainIconProps>;
}

/** 1.18× about the centre of the 24×24 box. */
const ZOOM = "translate(12 12) scale(1.18) translate(-12 -12)";

/** Wraps a glyph's paths in the shared 24×24 frame (+ the optional 1.18 zoom). */
function frame(body: (color: string) => React.ReactNode, zoom = false): React.FC<ChainIconProps> {
  return React.memo(function ChainIcon({ size, color }: ChainIconProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {zoom ? <G transform={ZOOM}>{body(color)}</G> : body(color)}
      </Svg>
    );
  });
}

const MonadIcon = frame(
  (c) => (
    <Path
      fill={c}
      d="M12 3c-2.599 0-9 6.4-9 9s6.401 9 9 9 9-6.401 9-9-6.401-9-9-9m-1.402 14.146c-1.097-.298-4.043-5.453-3.744-6.549s5.453-4.042 6.549-3.743c1.095.298 4.042 5.453 3.743 6.549-.298 1.095-5.453 4.042-6.549 3.743"
    />
  ),
  true
);

const EthIcon = frame(
  (c) => (
    <>
      <Path fill={c} d="M12 3v6.652l5.625 2.516zm0 0-5.625 9.166L12 9.652zm0 13.478V21l5.625-7.785zM12 21v-4.522l-5.625-3.263z" />
      <Path fill={c} d="m12 15.43 5.625-3.263L12 9.652zm-5.625-3.263L12 15.43V9.652z" />
      <Path
        fill={c}
        fillRule="evenodd"
        d="m12 15.43-5.625-3.262L12 3l5.625 9.166zm-5.25-3.528 5.162-8.41v6.115zm-.077.229 5.239-2.327v5.364zm5.418-2.327v5.364l5.233-3.037zm0-.197 5.162 2.295-5.162-8.41z"
        clipRule="evenodd"
      />
      <Path
        fill={c}
        fillRule="evenodd"
        d="m12 16.407-5.625-3.195L12 21l5.625-7.789zm-4.995-2.633 4.906 2.79v4.005zm5.085 2.79v4.005l4.904-6.795z"
        clipRule="evenodd"
      />
    </>
  ),
  true
);

const BaseIcon = frame((c) => (
  <Path
    fill={c}
    d="M3 4.706c0-.585 0-.877.11-1.101.106-.215.28-.39.496-.495C3.83 3 4.122 3 4.706 3h14.588c.585 0 .876 0 1.101.11.215.105.389.28.494.495.111.225.111.517.111 1.101v14.588c0 .585 0 .876-.11 1.101-.106.215-.28.389-.495.494-.225.111-.517.111-1.101.111H4.706c-.585 0-.876 0-1.101-.11a1.08 1.08 0 0 1-.494-.495C3 20.17 3 19.878 3 19.294z"
  />
));

const SolanaIcon = frame(
  (c) => (
    <Path
      fill={c}
      d="M18.413 7.903a.62.62 0 0 1-.411.162H3.58c-.512 0-.77-.585-.416-.928l2.369-2.283a.6.6 0 0 1 .41-.17H20.42c.517 0 .77.591.41.935zm0 11.255a.62.62 0 0 1-.411.157H3.58c-.512 0-.77-.58-.416-.922l2.369-2.29a.6.6 0 0 1 .41-.163H20.42c.517 0 .77.585.41.928zm0-8.686a.62.62 0 0 0-.411-.157H3.58c-.512 0-.77.58-.416.922l2.369 2.29a.6.6 0 0 0 .41.163H20.42c.517 0 .77-.585.41-.928z"
    />
  ),
  true
);

const SuiIcon = frame(
  (c) => (
    <Path
      fill={c}
      d="M16.129 10.508a5.44 5.44 0 0 1 1.148 3.356 5.47 5.47 0 0 1-1.18 3.4l-.064.079-.016-.107a5 5 0 0 0-.053-.26c-.37-1.656-1.566-3.08-3.546-4.233-1.334-.774-2.102-1.705-2.304-2.765a4.1 4.1 0 0 1 .16-1.969c.15-.494.385-.961.693-1.376l.773-.963a.334.334 0 0 1 .519 0zm1.217-.964L12.19 3.092a.243.243 0 0 0-.38 0L6.653 9.549l-.016.016a7.1 7.1 0 0 0-1.52 4.405C5.118 17.85 8.199 21 12 21s6.883-3.15 6.883-7.03a7.1 7.1 0 0 0-1.52-4.405zm-9.46.943.46-.577.017.105.037.255c.301 1.604 1.366 2.938 3.15 3.97 1.551.905 2.45 1.943 2.71 3.081.1.443.128.898.079 1.35v.027l-.021.01a5.2 5.2 0 0 1-2.319.544c-2.911 0-5.278-2.412-5.278-5.388a5.44 5.44 0 0 1 1.165-3.377"
    />
  ),
  true
);

const AptosIcon = frame(
  (c) => (
    <Path
      fill={c}
      d="M15.336 9.02a.65.65 0 0 1-.483-.217l-.643-.726a.507.507 0 0 0-.757 0l-.552.623a.95.95 0 0 1-.713.322h-8.68a9 9 0 0 0-.473 2.221h8.196a.53.53 0 0 0 .38-.163l.764-.796a.5.5 0 0 1 .365-.155h.031c.145 0 .283.061.379.17l.643.726a.65.65 0 0 0 .483.218h6.69a9 9 0 0 0-.473-2.221zm-7.341 6.894a.53.53 0 0 0 .38-.163l.764-.796a.5.5 0 0 1 .365-.156h.031c.145 0 .283.062.379.17l.643.727a.65.65 0 0 0 .483.218h9.066c.34-.702.588-1.456.736-2.244h-8.701a.65.65 0 0 1-.483-.217l-.643-.727a.507.507 0 0 0-.757 0l-.552.624a.95.95 0 0 1-.713.321H3.158c.148.789.397 1.542.737 2.243zm6.431-9.32a.53.53 0 0 0 .382-.163l.763-.796a.5.5 0 0 1 .364-.155h.032c.144 0 .283.061.378.17l.643.727a.65.65 0 0 0 .484.217h1.723A8.99 8.99 0 0 0 12.001 3a8.99 8.99 0 0 0-7.195 3.594zm-5.82 11.544a.65.65 0 0 1-.484-.218l-.643-.726a.507.507 0 0 0-.756 0l-.552.623a.95.95 0 0 1-.713.321h-.037A8.97 8.97 0 0 0 12.001 21a8.97 8.97 0 0 0 6.578-2.862z"
    />
  ),
  true
);

export const CHAINS: ChainMeta[] = [
  { id: "monad", name: "Monad", subtitle: "testnet", symbol: "MON", color: "rgb(110, 86, 207)", Icon: MonadIcon },
  { id: "sepolia", name: "Ethereum", subtitle: "testnet", symbol: "ETH", color: "rgb(232, 174, 58)", Icon: EthIcon },
  { id: "solana", name: "Solana", subtitle: "devnet", symbol: "SOL", color: "rgb(168, 85, 222)", Icon: SolanaIcon },
  { id: "sui", name: "Sui", subtitle: "testnet", symbol: "SUI", color: "rgb(56, 178, 255)", Icon: SuiIcon },
  { id: "base_sepolia", name: "Base", subtitle: "testnet", symbol: "ETH", color: "rgb(56, 116, 255)", Icon: BaseIcon },
  { id: "aptos", name: "Aptos", subtitle: "testnet", symbol: "APT", color: "rgb(241, 122, 73)", Icon: AptosIcon },
];

export const CHAIN_BY_ID: Record<NetworkId, ChainMeta> = CHAINS.reduce(
  (acc, c) => {
    acc[c.id] = c;
    return acc;
  },
  {} as Record<NetworkId, ChainMeta>
);
