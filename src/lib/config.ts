/**
 * config.ts — the noid half's deployment constants.
 *
 * Mirrors the extension's `process.env.PLASMO_PUBLIC_*` reads one key at a
 * time; Expo inlines `EXPO_PUBLIC_*` at BUILD time exactly the same way, which
 * is why every read below has to be a literal `process.env.EXPO_PUBLIC_FOO`
 * and not a lookup through a variable — the bundler does a textual substitution
 * and cannot follow indirection.
 *
 * Fallbacks are the extension's own defaults, so a missing .env degrades to the
 * addresses that shipped rather than to undefined.
 */

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE || "https://wallet-hjud.onrender.com/api";

/* ── Solana devnet ── */
export const SOLANA_RPC = "https://api.devnet.solana.com";
export const SOLANA_PROGRAM_ID =
  process.env.EXPO_PUBLIC_SOLANA_PROGRAM_ID ||
  "3wxDTqw42qqftiAcTZ6kLeNtepuSmB1mR1skrEcwD9SC";

/* ── Sui testnet ── */
export const SUI_RPC =
  process.env.EXPO_PUBLIC_SUI_RPC_URL || "https://sui-testnet-rpc.publicnode.com";
export const SUI_PACKAGE_ID =
  process.env.EXPO_PUBLIC_SUI_PACKAGE_ID ||
  "0x9467f20713dc371b452d3def674ee873d50c5850b2eaa944a3856f61dfdbaa60";
export const SUI_POOL_STATE_ID =
  process.env.EXPO_PUBLIC_SUI_POOL_STATE_ID ||
  "0x65ce5b0d1f57a527979dc92d7e3a7eb44650343ff012e13197087a9b9065eba2";

/* ── Aptos testnet ──
   Two different addresses, and mixing them up is a silent failure: MODULE is
   where the Move code lives, POOL is the object the entry function is called
   ON. (networks.ts's `poolAddress` for aptos is a THIRD one — the pool's
   resource account — which is what the indexer watches.) */
export const APTOS_NODE_URL = "https://fullnode.testnet.aptoslabs.com/v1";
export const APTOS_MODULE_ADDR =
  process.env.EXPO_PUBLIC_APTOS_MODULE_ADDR ||
  "0x4f79d41d0085866c731825690954720e4543b71c254030f7c86c56b86f8f8c76";
export const APTOS_POOL_ADDR =
  process.env.EXPO_PUBLIC_APTOS_POOL_ADDR ||
  "0xb50ddea69fa72666f7fc54ad9e1814a66e47ea61288131b0991e17a2ef08dabb";
