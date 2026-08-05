/**
 * keyDerivation.ts — multi-chain key derivation (RN-safe, no heavy chain SDKs).
 *
 * EVM is derived fully with ethers (real address + a "menoid_Wallet" signature
 * identity). Solana / Sui / Aptos base accounts are derived from the BIP-39
 * seed via SLIP-0010 ed25519 (real, standard addresses). Their noid identities
 * follow the same signature scheme as the extension.
 *
 * NOTE on noid keys: the extension computes the spend public key as an actual
 * BabyJubJub point (sk·Base8). Here — where these keys are identity/display
 * values, not ZK-proof inputs — the point is approximated with Poseidon field
 * elements. When on-chain/ZK is wired up later, swap spendKeysFromSeed() for a
 * real BabyJubJub scalar-mult; nothing else changes. See [[menoid-user-commitment-architecture]].
 */
import { ethers } from "ethers";
import { hmac } from "@noble/hashes/hmac";
import { sha512, sha256 as nobleSha256 } from "@noble/hashes/sha2";
import { sha3_256 } from "@noble/hashes/sha3";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, utf8ToBytes, concatBytes } from "@noble/hashes/utils";
import { poseidon2, poseidon3 } from "poseidon-lite";
import nacl from "tweetnacl";
import bs58 from "bs58";

const REGISTRATION_MESSAGE = "menoid_Wallet";
const BABYJUB_ORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;
const BN254_P =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface Account {
  address: string;
  privateKey: string;
  publicKey: string;
}
export interface NoidAccount extends Account {
  zkSecretKey: string;
  zkPublicKey: string;
}
export interface FullWallet {
  normalAccount?: Account;
  noidAccount?: NoidAccount;
  solanaAccount?: Account;
  solanaNoidAccount?: NoidAccount;
  suiAccount?: Account;
  suiNoidAccount?: NoidAccount;
  aptosAccount?: Account;
  aptosNoidAccount?: NoidAccount;
  seedPhrase?: string;
  importedNetwork?: "ethereum" | "solana" | "sui" | "aptos";
}

// ── noid identity helpers ──────────────────────────────────────────────────
function spendKeysFromSeed(skBig: bigint): { sk: string; px: string; py: string } {
  const sk = ((skBig % BABYJUB_ORDER) + BABYJUB_ORDER) % BABYJUB_ORDER;
  const px = poseidon2([sk, 0n]).toString();
  const py = poseidon2([sk, 1n]).toString();
  return { sk: sk.toString(), px, py };
}
function commitment(addressField: bigint, px: string, py: string): string {
  return poseidon3([addressField, BigInt(px), BigInt(py)]).toString();
}
function sha256Concat(tag: string, sig: Uint8Array): Uint8Array {
  return nobleSha256(concatBytes(utf8ToBytes(tag), sig));
}

// ── EVM ─────────────────────────────────────────────────────────────────────
export function deriveNormalAccount(seedPhrase: string): Account {
  const w = ethers.HDNodeWallet.fromPhrase(seedPhrase.trim());
  return {
    address: w.address,
    privateKey: w.privateKey,
    publicKey: ethers.SigningKey.computePublicKey(w.privateKey, false),
  };
}
export function deriveNormalAccountFromPrivateKey(pk: string): Account {
  const w = new ethers.Wallet(pk.trim());
  return {
    address: w.address,
    privateKey: w.privateKey,
    publicKey: ethers.SigningKey.computePublicKey(w.privateKey, false),
  };
}
export async function deriveNoidAccount(evmPrivateKey: string): Promise<NoidAccount> {
  const w = new ethers.Wallet(evmPrivateKey.trim());
  const sig = await w.signMessage(REGISTRATION_MESSAGE);
  const spendSk = BigInt(
    ethers.solidityPackedKeccak256(["string", "bytes"], ["menoid/spend", sig])
  );
  const spend = spendKeysFromSeed(spendSk);
  const encPriv = ethers.solidityPackedKeccak256(
    ["string", "bytes"],
    ["menoid/encryption", sig]
  );
  return {
    address: w.address,
    privateKey: encPriv,
    publicKey: ethers.SigningKey.computePublicKey(encPriv, false),
    zkSecretKey: spend.sk,
    zkPublicKey: commitment(BigInt(w.address), spend.px, spend.py),
  };
}

// ── SLIP-0010 ed25519 (hardened path) ────────────────────────────────────────
function slip10Derive(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, utf8ToBytes("ed25519 seed"), seed);
  let k = I.slice(0, 32);
  let c = I.slice(32);
  for (const seg of path) {
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0;
    data.set(k, 1);
    const idx = (0x80000000 + seg) >>> 0; // hardened
    data[33] = (idx >>> 24) & 0xff;
    data[34] = (idx >>> 16) & 0xff;
    data[35] = (idx >>> 8) & 0xff;
    data[36] = idx & 0xff;
    I = hmac(sha512, c, data);
    k = I.slice(0, 32);
    c = I.slice(32);
  }
  return k;
}
function seedFromMnemonic(phrase: string): Uint8Array {
  const hex = ethers.Mnemonic.fromPhrase(phrase.trim()).computeSeed();
  return ethers.getBytes(hex);
}

// ── Solana ────────────────────────────────────────────────────────────────
export function deriveSolanaAccount(seedPhrase: string): Account {
  const k = slip10Derive(seedFromMnemonic(seedPhrase), [44, 501, 0, 0]);
  const kp = nacl.sign.keyPair.fromSeed(k);
  return {
    address: bs58.encode(kp.publicKey),
    privateKey: bs58.encode(kp.secretKey),
    publicKey: bs58.encode(kp.publicKey),
  };
}
export async function deriveSolanaNoidAccount(seedPhrase: string): Promise<NoidAccount> {
  const k = slip10Derive(seedFromMnemonic(seedPhrase), [44, 501, 0, 0]);
  const kp = nacl.sign.keyPair.fromSeed(k);
  const sig = nacl.sign.detached(utf8ToBytes(REGISTRATION_MESSAGE), kp.secretKey);
  const spend = spendKeysFromSeed(BigInt("0x" + bytesToHex(sha256Concat("menoid/spend", sig))));
  const encKp = nacl.sign.keyPair.fromSeed(sha256Concat("menoid/encryption", sig));
  const addrField = BigInt("0x" + bytesToHex(kp.publicKey)) % BN254_P;
  return {
    address: bs58.encode(kp.publicKey),
    privateKey: bs58.encode(encKp.secretKey),
    publicKey: bs58.encode(encKp.publicKey),
    zkSecretKey: spend.sk,
    zkPublicKey: commitment(addrField, spend.px, spend.py),
  };
}

// ── Sui ──────────────────────────────────────────────────────────────────
function suiAddress(pub: Uint8Array): string {
  const flagged = concatBytes(new Uint8Array([0x00]), pub); // 0x00 = ed25519 flag
  return "0x" + bytesToHex(blake2b(flagged, { dkLen: 32 }));
}
export function deriveSuiAccount(seedPhrase: string): Account {
  const k = slip10Derive(seedFromMnemonic(seedPhrase), [44, 784, 0, 0, 0]);
  const kp = nacl.sign.keyPair.fromSeed(k);
  return {
    address: suiAddress(kp.publicKey),
    privateKey: "0x" + bytesToHex(k),
    publicKey: Buffer.from(kp.publicKey).toString("base64"),
  };
}
export async function deriveSuiNoidAccount(seedPhrase: string): Promise<NoidAccount> {
  const k = slip10Derive(seedFromMnemonic(seedPhrase), [44, 784, 0, 0, 0]);
  const kp = nacl.sign.keyPair.fromSeed(k);
  const sig = nacl.sign.detached(utf8ToBytes(REGISTRATION_MESSAGE), kp.secretKey);
  const spend = spendKeysFromSeed(BigInt("0x" + bytesToHex(sha256Concat("menoid/spend", sig))));
  const encKp = nacl.sign.keyPair.fromSeed(sha256Concat("menoid/encryption", sig));
  const addr = suiAddress(kp.publicKey);
  return {
    address: addr,
    privateKey: "0x" + bytesToHex(encKp.secretKey),
    publicKey: Buffer.from(encKp.publicKey).toString("base64"),
    zkSecretKey: spend.sk,
    zkPublicKey: commitment(BigInt(addr) % BN254_P, spend.px, spend.py),
  };
}

// ── Aptos ────────────────────────────────────────────────────────────────
function aptosAddress(pub: Uint8Array): string {
  const authKey = sha3_256(concatBytes(pub, new Uint8Array([0x00]))); // 0x00 = single ed25519
  return "0x" + bytesToHex(authKey);
}
export function deriveAptosAccount(seedPhrase: string): Account {
  const k = slip10Derive(seedFromMnemonic(seedPhrase), [44, 637, 0, 0, 0]);
  const kp = nacl.sign.keyPair.fromSeed(k);
  return {
    address: aptosAddress(kp.publicKey),
    privateKey: "0x" + bytesToHex(k),
    publicKey: "0x" + bytesToHex(kp.publicKey),
  };
}
export async function deriveAptosNoidAccount(seedPhrase: string): Promise<NoidAccount> {
  const k = slip10Derive(seedFromMnemonic(seedPhrase), [44, 637, 0, 0, 0]);
  const kp = nacl.sign.keyPair.fromSeed(k);
  const sig = nacl.sign.detached(utf8ToBytes(REGISTRATION_MESSAGE), kp.secretKey);
  const spend = spendKeysFromSeed(BigInt("0x" + bytesToHex(sha256Concat("menoid/spend", sig))));
  const encKp = nacl.sign.keyPair.fromSeed(sha256Concat("menoid/encryption", sig));
  const addr = aptosAddress(kp.publicKey);
  return {
    address: addr,
    privateKey: "0x" + bytesToHex(encKp.secretKey),
    publicKey: "0x" + bytesToHex(encKp.publicKey),
    zkSecretKey: spend.sk,
    zkPublicKey: commitment(BigInt(addr) % BN254_P, spend.px, spend.py),
  };
}

// ── Full-wallet generators ────────────────────────────────────────────────
export function generateMnemonicOnly(): { mnemonic: string } {
  const w = ethers.Wallet.createRandom();
  const m = w.mnemonic?.phrase;
  if (!m) throw new Error("Failed to generate mnemonic");
  return { mnemonic: m };
}

export async function importFromMnemonic(phrase: string): Promise<FullWallet> {
  const normalAccount = deriveNormalAccount(phrase);
  const noidAccount = await deriveNoidAccount(normalAccount.privateKey);
  const out: FullWallet = { normalAccount, noidAccount, seedPhrase: phrase.trim() };
  // Non-EVM chains are best-effort so one failure can never block creation.
  try {
    out.solanaAccount = deriveSolanaAccount(phrase);
    out.solanaNoidAccount = await deriveSolanaNoidAccount(phrase);
  } catch (e) {
    console.warn("[keyDerivation] solana:", e);
  }
  try {
    out.suiAccount = deriveSuiAccount(phrase);
    out.suiNoidAccount = await deriveSuiNoidAccount(phrase);
  } catch (e) {
    console.warn("[keyDerivation] sui:", e);
  }
  try {
    out.aptosAccount = deriveAptosAccount(phrase);
    out.aptosNoidAccount = await deriveAptosNoidAccount(phrase);
  } catch (e) {
    console.warn("[keyDerivation] aptos:", e);
  }
  return out;
}

export async function importFromPrivateKey(
  pk: string,
  network: "ethereum" | "solana" | "sui" | "aptos" = "ethereum"
): Promise<FullWallet> {
  if (network === "ethereum") {
    const normalAccount = deriveNormalAccountFromPrivateKey(pk);
    const noidAccount = await deriveNoidAccount(normalAccount.privateKey);
    return { normalAccount, noidAccount, importedNetwork: "ethereum" };
  }
  if (network === "solana") {
    const decoded = bs58.decode(pk.trim());
    const kp =
      decoded.length === 64
        ? nacl.sign.keyPair.fromSecretKey(decoded)
        : nacl.sign.keyPair.fromSeed(decoded.slice(0, 32));
    const acct: Account = {
      address: bs58.encode(kp.publicKey),
      privateKey: bs58.encode(kp.secretKey),
      publicKey: bs58.encode(kp.publicKey),
    };
    return { solanaAccount: acct, importedNetwork: "solana" };
  }
  if (network === "aptos") {
    const seed = ethers.getBytes(pk.trim().startsWith("0x") ? pk.trim() : "0x" + pk.trim());
    const kp = nacl.sign.keyPair.fromSeed(seed.slice(0, 32));
    const acct: Account = {
      address: aptosAddress(kp.publicKey),
      privateKey: "0x" + bytesToHex(seed.slice(0, 32)),
      publicKey: "0x" + bytesToHex(kp.publicKey),
    };
    return { aptosAccount: acct, importedNetwork: "aptos" };
  }
  // sui
  const seed = ethers.getBytes(pk.trim().startsWith("0x") ? pk.trim() : "0x" + pk.trim());
  const kp = nacl.sign.keyPair.fromSeed(seed.slice(0, 32));
  const acct: Account = {
    address: suiAddress(kp.publicKey),
    privateKey: "0x" + bytesToHex(seed.slice(0, 32)),
    publicKey: Buffer.from(kp.publicKey).toString("base64"),
  };
  return { suiAccount: acct, importedNetwork: "sui" };
}
