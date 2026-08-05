/**
 * walletCrypto.ts — password encryption for the whole wallet.
 *
 * PBKDF2(SHA-256, 200k) → AES-256-GCM, implemented with @noble so it runs
 * identically on a native Android build without WebCrypto. The wire format
 * (hex ciphertext / iv / salt) matches the extension byte-for-byte, so a wallet
 * encrypted here decrypts there and vice-versa.
 */
import { pbkdf2 as noblePbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { pbkdf2Sync as quickPbkdf2Sync } from "react-native-quick-crypto";

const PBKDF2_ITERATIONS = 200_000;
const SALT_LEN = 16;
const IV_LEN = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

function buf2hex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function hex2buf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}
/**
 * PBKDF2-SHA256, 200k iterations → a 32-byte AES key.
 *
 * Runs NATIVE (react-native-quick-crypto). The pure-JS @noble version is
 * correct but takes 30–60s on Hermes, which has no JIT — long enough that
 * unlocking looked broken. Both produce identical bytes, so the stored wire
 * format is unchanged and the @noble path stays as a fallback for any runtime
 * where the native module isn't linked (e.g. a plain web/node harness).
 */
function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  try {
    const out = quickPbkdf2Sync(
      Buffer.from(password, "utf8"),
      Buffer.from(salt),
      PBKDF2_ITERATIONS,
      32,
      "sha256"
    );
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch (e) {
    console.warn("[walletCrypto] native pbkdf2 unavailable, falling back to JS:", e);
    return noblePbkdf2(sha256, enc.encode(password), salt, {
      c: PBKDF2_ITERATIONS,
      dkLen: 32,
    });
  }
}

export interface EncryptedWallet {
  ciphertext: string;
  iv: string;
  salt: string;
}

export interface StoredAccount {
  address: string;
  privateKey: string;
  publicKey: string;
}
export interface NoidAccount extends StoredAccount {
  zkSecretKey: string;
  zkPublicKey: string;
}

export interface StoredWallet {
  normalAccount?: StoredAccount;
  noidAccount?: NoidAccount;
  solanaAccount?: StoredAccount;
  solanaNoidAccount?: NoidAccount;
  suiAccount?: StoredAccount;
  suiNoidAccount?: NoidAccount;
  aptosAccount?: StoredAccount;
  aptosNoidAccount?: NoidAccount;
  seedPhrase?: string;
  importedNetwork?: "ethereum" | "solana" | "sui" | "aptos";
}

export async function encryptWallet(
  wallet: StoredWallet,
  password: string
): Promise<EncryptedWallet> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt);
  const cipher = gcm(key, iv).encrypt(enc.encode(JSON.stringify(wallet)));
  return { ciphertext: buf2hex(cipher), iv: buf2hex(iv), salt: buf2hex(salt) };
}

export async function decryptWallet(
  encrypted: EncryptedWallet,
  password: string
): Promise<StoredWallet> {
  const salt = hex2buf(encrypted.salt);
  const iv = hex2buf(encrypted.iv);
  const cipher = hex2buf(encrypted.ciphertext);
  const key = deriveKey(password, salt);
  let plain: Uint8Array;
  try {
    plain = gcm(key, iv).decrypt(cipher);
  } catch {
    throw new Error("Wrong password");
  }
  return JSON.parse(dec.decode(plain)) as StoredWallet;
}

/* Password-strength meter — same five steps/colors as the extension, lifted
   toward the light end so they read as tints of the lilac sky. */
const STRENGTH_STEPS = [
  { score: 0, label: "Too short" as const, color: "#FF9FBE" },
  { score: 1, label: "Weak" as const, color: "#FFB48C" },
  { score: 2, label: "Fair" as const, color: "#FFDD8F" },
  { score: 3, label: "Strong" as const, color: "#B9F0A5" },
  { score: 4, label: "Very strong" as const, color: "#8DF0CE" },
];

export function passwordStrength(pw: string) {
  if (pw.length < 6) return STRENGTH_STEPS[0];
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return STRENGTH_STEPS[Math.min(s, 4)];
}
