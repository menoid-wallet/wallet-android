/**
 * Verifies src/crypto/babyjub.ts against circomlibjs — the implementation the
 * browser extension uses. The spend public key feeds the user commitment, so a
 * single differing bit would give the app a different on-chain identity than
 * the extension for the same seed.
 *
 *   node --experimental-strip-types scripts/verify-babyjub.ts
 */
import { createRequire } from "node:module";
import { mulPointBase8, BABYJUB_SUBGROUP_ORDER } from "../src/crypto/babyjub.ts";

const require = createRequire(
  "/Users/maheshkarri/Desktop/Web3/Web3 Projects/menoid_codes/wallet/wallet-extension/"
);
const { buildBabyjub } = require("circomlibjs");

const babyJub = await buildBabyjub();

const cases: bigint[] = [
  1n,
  2n,
  12345n,
  BABYJUB_SUBGROUP_ORDER - 1n,
  0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn,
];
for (let i = 0; i < 20; i++) {
  let r = 0n;
  for (const b of crypto.getRandomValues(new Uint8Array(32))) r = (r << 8n) | BigInt(b);
  cases.push(r);
}

let pass = 0;
for (const sk of cases) {
  const reduced = ((sk % BABYJUB_SUBGROUP_ORDER) + BABYJUB_SUBGROUP_ORDER) % BABYJUB_SUBGROUP_ORDER;
  const expected = babyJub.mulPointEscalar(babyJub.Base8, reduced);
  const want = { x: babyJub.F.toString(expected[0]), y: babyJub.F.toString(expected[1]) };
  const got = mulPointBase8(sk);
  if (got.x !== want.x || got.y !== want.y) {
    console.error("MISMATCH for sk =", sk.toString());
    console.error("  circomlibjs:", want);
    console.error("  ours       :", got);
    process.exit(1);
  }
  pass++;
}
console.log(`✓ ${pass}/${cases.length} scalar multiplications match circomlibjs exactly`);

const t0 = performance.now();
for (let i = 0; i < 20; i++) mulPointBase8(BigInt(i) * 7919n + 12345n);
console.log(`  ${((performance.now() - t0) / 20).toFixed(1)}ms per scalar mult`);
