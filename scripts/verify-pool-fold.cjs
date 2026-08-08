/**
 * verify-pool-fold.cjs — proves the private balance is computed correctly.
 *
 * Runs the SHIPPED `foldPoolState` (context/PoolContext) against:
 *   1. the live Monad pool, to show real notes are processed and none of the
 *      24 strangers' notes are mistaken for ours;
 *   2. that same pool with three of OUR OWN notes spliced in, encrypted by the
 *      real `eciesjs` the extension uses, one of which is already spent.
 *
 * Needs the context transpiled first (Node cannot read the .tsx, and
 * react-native's Flow syntax has to be stubbed out — foldPoolState touches
 * neither):
 *
 *   npx tsc src/context/PoolContext.tsx --ignoreConfig --outDir .poolcheck \
 *     --module commonjs --target es2020 --moduleResolution bundler \
 *     --skipLibCheck --esModuleInterop --jsx react
 *   # then point its react / react-native / WalletContext requires at stubs
 *   node scripts/verify-pool-fold.cjs
 */
const path = require("path");
const { secp256k1 } = require("@noble/curves/secp256k1");
const { poseidon4 } = require("poseidon-lite");
const { ethers } = require("ethers");
const EXT = process.env.EXT || path.join(__dirname, "../../wallet/wallet-extension");
const ecies = require(path.join(EXT, "node_modules/eciesjs"));
const { foldPoolState } = require(path.join(__dirname, "../.poolcheck/context/PoolContext.js"));

const BASE = (require("fs").readFileSync(path.join(__dirname, "../.env"), "utf8")
  .split("\n").find((l) => l.startsWith("EXPO_PUBLIC_API_BASE")) || "").split("=")[1].trim();

let bad = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "  PASS " : "  FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) bad++; };

(async () => {
  const res = await fetch(`${BASE}/state/monad/latest`);
  const live = await res.json();
  const pool = live.poolStates[0];
  console.log(`live monad pool: ${pool.commitments.length} commitments, ${live.spentNullifiers.length} spent\n`);

  // our identity
  const sk = secp256k1.utils.randomPrivateKey();
  const keys = {
    privateKey: Buffer.from(sk).toString("hex"),
    zkSecretKey: "123456789012345678901234567890",
  };
  const pub = Buffer.from(secp256k1.getPublicKey(sk, false));

  console.log("1) live pool, none of it ours:");
  const r1 = foldPoolState(live, keys, "monad", {});
  check("no stranger's note is claimed", r1.utxos.length === 0, `utxos=${r1.utxos.length}`);
  check("balance is 0.0000", r1.balance === "0.0000", `balance=${r1.balance}`);

  console.log("\n2) three of our notes spliced in (one already spent):");
  const ours = [
    { amount: "1500000000000000000", randomness: "111111111111111111" }, // 1.5
    { amount: "2500000000000000000", randomness: "222222222222222222" }, // 2.5
    { amount: "9000000000000000000", randomness: "333333333333333333" }, // 9.0, spent
  ];
  const spliced = JSON.parse(JSON.stringify(live));
  const p = spliced.poolStates[0];
  ours.forEach((note, i) => {
    const cm = (BigInt("0x" + "ab".repeat(31)) + BigInt(i + 1)).toString();
    p.commitments.push(cm);
    p.encryptedNotes[cm] = "0x" + ecies.encrypt(pub, Buffer.from(JSON.stringify(note))).toString("hex");
    if (i === 2) {
      const n = poseidon4([2n, BigInt(cm), BigInt(note.randomness), BigInt(keys.zkSecretKey)]);
      spliced.spentNullifiers.push(ethers.zeroPadValue(ethers.toBeHex(n), 32));
    }
  });

  const r2 = foldPoolState(spliced, keys, "monad", {});
  check("finds exactly our two UNSPENT notes", r2.utxos.length === 2, `utxos=${r2.utxos.length}`);
  check("the spent one is excluded", !r2.utxos.some((u) => u.amount === "9000000000000000000"));
  check("balance = 1.5 + 2.5 = 4.0000", r2.balance === "4.0000", `balance=${r2.balance}`);

  console.log("\n3) the cache short-circuits a second pass:");
  const cache = {};
  foldPoolState(spliced, keys, "monad", cache);
  const before = JSON.stringify(cache);
  const r3 = foldPoolState(spliced, keys, "monad", cache);
  check("same balance on re-run", r3.balance === "4.0000", `balance=${r3.balance}`);
  check("cache unchanged", JSON.stringify(cache) === before);

  console.log(`\n${bad ? bad + " FAILED" : "all passed"}`);
  process.exit(bad ? 1 : 0);
})();
