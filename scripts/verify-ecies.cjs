const path = require("path");
const EXT = process.env.EXT;
const ecies = require(path.join(EXT, "node_modules/eciesjs"));
const extCrypto = require(path.join(EXT, "node_modules/tweetnacl"));
const mine = require("./ecies.js");
const { secp256k1 } = require("@noble/curves/secp256k1");
const bs58 = require("bs58").default || require("bs58");
const nacl = require("tweetnacl");

let pass = 0, fail = 0;
const check = (name, ok, extra="") => { console.log((ok ? "  PASS " : "  FAIL ") + name + (extra ? "  " + extra : "")); ok ? pass++ : fail++; };

// ── EVM: encrypt with the REAL eciesjs, decrypt with the port ──────────────
console.log("EVM (secp256k1 ECIES) — encrypted by real eciesjs, opened by the port:");
for (let i = 0; i < 6; i++) {
  const sk = secp256k1.utils.randomPrivateKey();
  const skHex = Buffer.from(sk).toString("hex");
  const pubUncompressed = secp256k1.getPublicKey(sk, false);
  const note = JSON.stringify({ amount: String(10n ** BigInt(15 + i)), randomness: "1234567890".repeat(i + 1) });
  const ct = ecies.encrypt(Buffer.from(pubUncompressed), Buffer.from(note, "utf8"));
  let got = null, err = null;
  try { got = mine.decryptMessage("0x" + ct.toString("hex"), skHex, "monad"); } catch (e) { err = e.message; }
  check(`note ${i} (${note.length} bytes)`, got === note, err ? "err=" + err : "");
}

// a note that is NOT ours must throw, not return garbage
{
  const skA = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");
  const skB = secp256k1.utils.randomPrivateKey();
  const ct = ecies.encrypt(Buffer.from(secp256k1.getPublicKey(skB, false)), Buffer.from("someone else's note"));
  let threw = false;
  try { mine.decryptMessage("0x" + ct.toString("hex"), skA, "monad"); } catch { threw = true; }
  check("someone else's note throws", threw);
}

// ── NaCl box chains: encrypt the extension's way, decrypt with the port ────
function extEncryptBox(message, edPubBytes) {
  const recipientCurvePub = mine.ed25519PubkeyToCurve25519(edPubBytes);
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const enc = nacl.box(new TextEncoder().encode(message), nonce, recipientCurvePub, eph.secretKey);
  const out = new Uint8Array(32 + 24 + enc.length);
  out.set(eph.publicKey, 0); out.set(nonce, 32); out.set(enc, 56);
  return "0x" + Buffer.from(out).toString("hex");
}
console.log("Solana / Aptos (NaCl box over converted Ed25519 keys):");
{
  const kp = nacl.sign.keyPair();
  const note = JSON.stringify({ amount: "5000000000", randomness: "42" });
  const ct = extEncryptBox(note, kp.publicKey);
  check("solana", mine.decryptMessage(ct, bs58.encode(Buffer.from(kp.secretKey)), "solana") === note);
  check("aptos",  mine.decryptMessage(ct, "0x" + Buffer.from(kp.secretKey.slice(0,32)).toString("hex"), "aptos") === note);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
