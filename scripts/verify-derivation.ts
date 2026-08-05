/**
 * Cross-checks the app's key derivation against the browser extension's, using
 * the extension's OWN modules (@solana/web3.js, @mysten/sui, @aptos-labs/ts-sdk,
 * circomlibjs, bip39, ed25519-hd-key). Same seed must produce the same
 * addresses, the same spend keys and the same user commitments on all 4 chains.
 *
 *   node --experimental-strip-types scripts/verify-derivation.ts
 */
import * as app from "../src/crypto/__verify_kd.ts";

const EXT = "/Users/maheshkarri/Desktop/Web3/Web3 Projects/menoid_codes/wallet/wallet-extension/crypto/keyDerivation.ts";
const ext: any = await import(EXT);

const phrase = "test walk nut penalty hip pave soap entry language right filter choice";
console.log("seed phrase:", phrase, "\n");

const [a, e] = await Promise.all([app.importFromMnemonic(phrase), ext.importFromMnemonic(phrase)]);

const rows: [string, string | undefined, string | undefined][] = [];
const cmp = (label: string, x?: string, y?: string) => rows.push([label, x, y]);

cmp("EVM address", a.normalAccount?.address, e.normalAccount?.address);
cmp("EVM  spend sk", a.noidAccount?.zkSecretKey, e.noidAccount?.zkSecretKey);
cmp("EVM  commitment", a.noidAccount?.zkPublicKey, e.noidAccount?.zkPublicKey);
cmp("EVM  enc pubkey", a.noidAccount?.publicKey, e.noidAccount?.publicKey);

cmp("SOL address", a.solanaAccount?.address, e.solanaAccount?.address);
cmp("SOL  spend sk", a.solanaNoidAccount?.zkSecretKey, e.solanaNoidAccount?.zkSecretKey);
cmp("SOL  commitment", a.solanaNoidAccount?.zkPublicKey, e.solanaNoidAccount?.zkPublicKey);

cmp("SUI address", a.suiAccount?.address, e.suiAccount?.address);
cmp("SUI  spend sk", a.suiNoidAccount?.zkSecretKey, e.suiNoidAccount?.zkSecretKey);
cmp("SUI  commitment", a.suiNoidAccount?.zkPublicKey, e.suiNoidAccount?.zkPublicKey);

cmp("APT address", a.aptosAccount?.address, e.aptosAccount?.address);
cmp("APT  spend sk", a.aptosNoidAccount?.zkSecretKey, e.aptosNoidAccount?.zkSecretKey);
cmp("APT  commitment", a.aptosNoidAccount?.zkPublicKey, e.aptosNoidAccount?.zkPublicKey);

let bad = 0;
for (const [label, x, y] of rows) {
  const ok = x !== undefined && x === y;
  if (!ok) bad++;
  const shown = (v?: string) => (v ? (v.length > 30 ? v.slice(0, 14) + "…" + v.slice(-8) : v) : "—");
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(18)} app=${shown(x).padEnd(26)} ext=${shown(y)}`);
}
console.log("\n" + (bad === 0 ? `ALL ${rows.length} VALUES MATCH THE EXTENSION` : `${bad} MISMATCH(ES)`));
process.exit(bad === 0 ? 0 : 1);
