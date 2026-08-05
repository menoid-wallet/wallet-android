import * as kd from "../src/crypto/__verify_kd.ts";
const phrase = "test walk nut penalty hip pave soap entry language right filter choice";
const w = await kd.importFromMnemonic(phrase);

const checks: [string, any, any][] = [];
const evm = await kd.importFromPrivateKey(w.normalAccount!.privateKey, "ethereum");
checks.push(["EVM", evm.normalAccount!.address, w.normalAccount!.address]);
checks.push(["EVM commitment", evm.noidAccount!.zkPublicKey, w.noidAccount!.zkPublicKey]);

const sol = await kd.importFromPrivateKey(w.solanaAccount!.privateKey, "solana");
checks.push(["SOL", sol.solanaAccount!.address, w.solanaAccount!.address]);
checks.push(["SOL commitment", sol.solanaNoidAccount!.zkPublicKey, w.solanaNoidAccount!.zkPublicKey]);

const sui = await kd.importFromPrivateKey(w.suiAccount!.privateKey, "sui");
checks.push(["SUI", sui.suiAccount!.address, w.suiAccount!.address]);
checks.push(["SUI commitment", sui.suiNoidAccount!.zkPublicKey, w.suiNoidAccount!.zkPublicKey]);

const apt = await kd.importFromPrivateKey(w.aptosAccount!.privateKey, "aptos");
checks.push(["APT", apt.aptosAccount!.address, w.aptosAccount!.address]);
checks.push(["APT commitment", apt.aptosNoidAccount!.zkPublicKey, w.aptosNoidAccount!.zkPublicKey]);

let bad = 0;
for (const [l, got, want] of checks) {
  const ok = got === want; if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${l.padEnd(16)} ${String(got).slice(0, 22)}…`);
}
console.log(bad === 0 ? "\nprivate-key import == mnemonic import on all 4 chains" : `\n${bad} MISMATCH`);
process.exit(bad ? 1 : 0);
