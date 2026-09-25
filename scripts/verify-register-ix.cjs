/**
 * verify-register-ix.cjs — pins the hand-built Solana register instruction.
 *
 * services/register.ts builds the instruction directly instead of through
 * @coral-xyz/anchor (which is a large dependency to carry onto a phone for
 * eight bytes and two 32-byte arguments). This asserts the encoding it produces
 * is the one the real IDL describes: same discriminator, same account order,
 * same argument layout, same PDA seed.
 *
 * The seed check is not decoration. It moved from "registration" to
 * "registration_v2" when the encryption key was added to the account, and a
 * wallet still deriving the v1 address would look up an account that does not
 * exist and report every registered wallet as unregistered.
 *
 *   node scripts/verify-register-ix.cjs
 */
const crypto = require("crypto");
const path = require("path");
const IDL_PATH =
  process.env.IDL ||
  path.join(__dirname, "../../wallet/wallet-extension/abis/noid_solana.json");
const idl = require(IDL_PATH);

const ix = idl.instructions.find((i) => i.name === "register");
const disc = [...crypto.createHash("sha256").update("global:register").digest().subarray(0, 8)];
const accounts = ix.accounts.map((a) => [a.name, !!a.signer, !!a.writable]);

let bad = 0;
const eq = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? "PASS " : "FAIL ") + name);
  if (!ok) { console.log("  idl :", JSON.stringify(b)); console.log("  ours:", JSON.stringify(a)); bad++; }
};

eq("discriminator = sha256('global:register')[0..8]", disc, ix.discriminator);
eq("account order / flags", accounts, [
  ["user", true, true],
  ["registration", false, true],
  ["system_program", false, false],
]);
eq("argument layout", ix.args, [
  { name: "user_commitment", type: { array: ["u8", 32] } },
  { name: "encryption_public_key", type: { array: ["u8", 32] } },
]);

// The const seed the IDL records for the registration PDA, as text.
const seedConst = ix.accounts
  .find((a) => a.name === "registration")
  ?.pda?.seeds?.find((s) => s.kind === "const");
eq(
  "registration PDA seed",
  Buffer.from(seedConst ? seedConst.value : []).toString(),
  "registration_v2"
);

process.exit(bad ? 1 : 0);
