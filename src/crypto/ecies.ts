/**
 * ecies.ts — reading the encrypted notes in the privacy pool.
 *
 * Every commitment in a pool carries a note (`{amount, randomness}`) encrypted
 * to the recipient's noid encryption key. Finding your own balance means trying
 * to decrypt every note you have not already claimed; the ones that open are
 * yours. That is the whole of what this file is for.
 *
 * TWO SCHEMES, because the chains have two key types:
 *
 *   EVM (monad / sepolia / base sepolia) — secp256k1 ECIES, byte-for-byte
 *     compatible with the `eciesjs` package the extension uses. eciesjs cannot
 *     run here: 0.3.x pulls in node:crypto and the native `secp256k1` binding,
 *     neither of which exists in React Native. So the scheme is reimplemented
 *     on @noble/*, which the app already ships, and pinned by a cross-check
 *     against real eciesjs output (scripts/verify-ecies.mjs).
 *
 *     Wire format, and it is NOT the usual one:
 *       ephemeralPubUncompressed(65) ‖ nonce(16) ‖ tag(16) ‖ ciphertext
 *     Note the 16-byte GCM nonce (not 12) and the tag BEFORE the ciphertext
 *     rather than appended. Both are eciesjs quirks; both must be matched
 *     exactly or every note silently fails to open and the balance reads zero.
 *
 *   Solana / Sui / Aptos — NaCl box. The chains' Ed25519 keys are converted to
 *     their Curve25519 equivalents first (birational map for the public key,
 *     SHA-512-and-clamp for the secret), then it is a plain sealed box:
 *       ephemeralPub(32) ‖ nonce(24) ‖ box
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256, sha512 } from "@noble/hashes/sha2";
import { secp256k1 } from "@noble/curves/secp256k1";
import { gcm } from "@noble/ciphers/aes";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const P25519 = (1n << 255n) - 19n;

function strip0x(s: string): string {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let out = "";
  for (const x of b) out += x.toString(16).padStart(2, "0");
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ── Ed25519 → Curve25519 ── */

function expMod(base: bigint, exp: bigint, m: bigint): bigint {
  let res = 1n;
  let b = base % m;
  let e = exp;
  while (e > 0n) {
    if (e % 2n === 1n) res = (res * b) % m;
    b = (b * b) % m;
    e /= 2n;
  }
  return res;
}

/** The birational map: u = (1 + y) / (1 - y) over the Curve25519 field. */
export function ed25519PubkeyToCurve25519(edPub: Uint8Array): Uint8Array {
  const yBytes = new Uint8Array(edPub);
  yBytes[31] &= 0x7f; // drop the x sign bit
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(yBytes[i]);
  const num = (1n + y) % P25519;
  const den = (1n - y + P25519) % P25519;
  const u = (num * expMod(den, P25519 - 2n, P25519)) % P25519;
  const out = new Uint8Array(32);
  let t = u;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  return out;
}

/** SHA-512 of the seed, clamped — the same scalar Ed25519 signing derives. */
export function ed25519SecretKeyToCurve25519(edSec: Uint8Array): Uint8Array {
  const seed = edSec.length === 64 ? edSec.slice(0, 32) : edSec;
  const h = sha512(seed);
  const sec = new Uint8Array(h.slice(0, 32));
  sec[0] &= 248;
  sec[31] &= 127;
  sec[31] |= 64;
  return sec;
}

/* ── secp256k1 ECIES (eciesjs-compatible) ── */

const UNCOMPRESSED = 65;
const IV_LEN = 16;
const TAG_LEN = 16;

/**
 * eciesjs's `decapsulate`: HKDF-SHA256 over
 *   senderPubUncompressed(65) ‖ (receiverSecret · senderPub) uncompressed(65)
 * with no salt and no info, to 32 bytes.
 */
function sharedKey(receiverSecret: Uint8Array, senderPubUncompressed: Uint8Array): Uint8Array {
  const point = secp256k1.getSharedSecret(receiverSecret, senderPubUncompressed, false);
  return hkdf(sha256, concat(senderPubUncompressed, point), undefined, undefined, 32);
}

function decryptEvm(ciphertextHex: string, privateKeyHex: string): string {
  const msg = hexToBytes(ciphertextHex);
  const senderPub = msg.subarray(0, UNCOMPRESSED);
  const nonce = msg.subarray(UNCOMPRESSED, UNCOMPRESSED + IV_LEN);
  const tag = msg.subarray(UNCOMPRESSED + IV_LEN, UNCOMPRESSED + IV_LEN + TAG_LEN);
  const body = msg.subarray(UNCOMPRESSED + IV_LEN + TAG_LEN);

  const key = sharedKey(hexToBytes(privateKeyHex), senderPub);
  // noble wants ciphertext‖tag; eciesjs stores them the other way round.
  const plain = gcm(key, nonce).decrypt(concat(body, tag));
  return new TextDecoder().decode(plain);
}

/* ── NaCl box (solana / sui / aptos) ── */

function openBox(ciphertextHex: string, curveSecret: Uint8Array): string {
  const msg = hexToBytes(ciphertextHex);
  const ephemeralPub = msg.slice(0, 32);
  const nonce = msg.slice(32, 56);
  const body = msg.slice(56);
  const plain = nacl.box.open(body, nonce, ephemeralPub, curveSecret);
  if (!plain) throw new Error("box open failed");
  return new TextDecoder().decode(plain);
}

function solanaSecret(secretKeyBase58: string): Uint8Array {
  let ed: Uint8Array;
  try {
    ed = bs58.decode(secretKeyBase58.trim());
  } catch {
    ed = hexToBytes(secretKeyBase58.trim());
  }
  return ed25519SecretKeyToCurve25519(ed);
}

/* ── Writing a note (the mask side) ──
   Byte-for-byte the layout `decryptEvm` above expects, and the layout eciesjs
   produces: ephemeral uncompressed pubkey ‖ iv ‖ TAG ‖ ciphertext. The tag
   coming BEFORE the body is the eciesjs quirk; noble emits it after, so it is
   moved. Get this wrong and the note is unreadable by the extension — which is
   the same pool. */
function encryptEvm(plaintext: string, recipientPubHex: string): string {
  const recipient = hexToBytes(recipientPubHex);
  const ephSecret = secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(ephSecret, false); // uncompressed, 65

  const point = secp256k1.getSharedSecret(ephSecret, recipient, false);
  const key = hkdf(sha256, concat(ephPub, point), undefined, undefined, 32);

  const nonce = new Uint8Array(IV_LEN);
  (globalThis.crypto as Crypto).getRandomValues(nonce);

  const sealed = gcm(key, nonce).encrypt(new TextEncoder().encode(plaintext));
  const body = sealed.subarray(0, sealed.length - TAG_LEN);
  const tag = sealed.subarray(sealed.length - TAG_LEN);

  return "0x" + bytesToHex(concat(concat(concat(ephPub, nonce), tag), body));
}

function sealBox(plaintext: string, recipientCurvePub: Uint8Array): string {
  const eph = nacl.box.keyPair();
  const nonce = new Uint8Array(24);
  (globalThis.crypto as Crypto).getRandomValues(nonce);
  const body = nacl.box(
    new TextEncoder().encode(plaintext),
    nonce,
    recipientCurvePub,
    eph.secretKey
  );
  return "0x" + bytesToHex(concat(concat(eph.publicKey, nonce), body));
}

/**
 * Encrypt a note TO a recipient's noid encryption key, per chain.
 *
 * The mirror of decryptMessage — same envelope, same per-chain split.
 */
export function encryptNote(
  plaintext: string,
  recipientPublicKey: string,
  network: string = "monad"
): string {
  if (network === "solana" || network === "sui" || network === "aptos") {
    /* The stored key is an ed25519 public key; the box needs its curve25519
       twin, which is the same conversion the read side does. */
    return sealBox(
      plaintext,
      ed25519PubkeyToCurve25519(
        network === "solana" ? bs58.decode(recipientPublicKey.trim()) : hexToBytes(recipientPublicKey)
      )
    );
  }
  return encryptEvm(plaintext, recipientPublicKey);
}

/**
 * Decrypt a note with the noid ENCRYPTION key for this chain.
 *
 * Throws on anything that is not ours — which is the normal case, since every
 * pool is full of other people's notes. Callers treat a throw as "not mine".
 */
export function decryptMessage(
  ciphertextHex: string,
  privateKey: string,
  network: string = "monad"
): string {
  if (network === "solana") return openBox(ciphertextHex, solanaSecret(privateKey));
  if (network === "sui")
    return openBox(
      ciphertextHex,
      ed25519SecretKeyToCurve25519(decodeSuiPrivateKey(privateKey).secretKey)
    );
  if (network === "aptos")
    return openBox(ciphertextHex, ed25519SecretKeyToCurve25519(hexToBytes(privateKey)));
  return decryptEvm(ciphertextHex, privateKey);
}
