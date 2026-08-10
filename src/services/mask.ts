/**
 * mask.ts — "hide it": depositing into the ZK pool.
 *
 * Ported from the extension's services/mask.ts. The shape:
 *
 *   two notes are minted — c1 to YOU for the amount, c2 to the RELAYER for its
 *   fee — each a poseidon commitment over (amount, randomness, userCommitment),
 *   and each with its cleartext `{amount, randomness}` encrypted to the owner's
 *   noid key so only they can ever spend it. A groth16 proof then says "these
 *   two commitments are well-formed and sum to the value I am sending" without
 *   revealing either note. The pool checks the proof and takes the money.
 *
 * The transaction is signed HERE and relayed: the deposit must come from the
 * user's own wallet (it carries the value), but the wallet has no indexer, so
 * the backend broadcasts and updates pool state. Same split as registration.
 *
 * The proof itself is the part that could not exist on this platform until
 * recently — see services/zk.ts.
 */

import { Contract, ethers, Wallet } from "ethers";
import { poseidon4 } from "poseidon-lite";
import { Buffer } from "buffer";
import { encryptNote } from "../crypto/ecies";
import { NETWORKS, type NetworkId } from "../lib/networks";
import { BASE_URL } from "./api";
import { proveDeposit } from "./zk";

/** Only the one function is needed; the full pool ABI is ~40 kB of noise. */
const POOL_DEPOSIT_ABI = [
  "function deposit(uint256[2] a, uint256[2][2] b, uint256[2] c, bytes32 c1, bytes32 c2, bytes encNote1, bytes encNote2) payable",
];

export interface RelayerKeys {
  publicKey: string;
  zkPublicKey: string;
}

/** GET /api/relayer/get — the relayer's noid identity, shared across chains. */
export async function fetchRelayerKeys(network?: NetworkId): Promise<RelayerKeys> {
  const url = network ? `${BASE_URL}/relayer/get?network=${network}` : `${BASE_URL}/relayer/get`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't reach the relayer (${res.status}).`);
  return res.json();
}

/** A field element with 31 bytes of entropy — never 32, to stay under p. */
function randomFieldElement(): string {
  const bytes = new Uint8Array(31);
  (globalThis.crypto as Crypto).getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

function commitment(amount: bigint, randomness: string, zkPublicKey: string) {
  const c = poseidon4([1n, amount, BigInt(randomness), BigInt(zkPublicKey)]);
  return { decimal: c.toString(), bytes32: ethers.zeroPadValue(ethers.toBeHex(c), 32) };
}

export interface MaskArgs {
  /** GROSS decimal amount leaving the wallet — the fee is inside it. */
  depositAmount: string;
  /** decimal relayer fee */
  fee: string;
  network: NetworkId;
  /** the real (open-mode) key that pays */
  privateKey: string;
  /** this wallet's noid encryption key + user commitment for the chain */
  noidPublicKey: string;
  noidZkPublicKey: string;
  onProving?: () => void;
  onSending?: (hash: string) => void;
}

export async function executeMask({
  depositAmount,
  fee,
  network,
  privateKey,
  noidPublicKey,
  noidZkPublicKey,
  onProving,
  onSending,
}: MaskArgs): Promise<{ hash: string }> {
  const net = NETWORKS[network];
  if (!net?.poolAddress) throw new Error(`No pool configured for ${network}.`);

  const depositWei = ethers.parseEther(depositAmount);
  const feeWei = ethers.parseEther(fee);
  const userWei = depositWei - feeWei;
  if (userWei <= 0n) throw new Error("Amount must be more than the relayer fee.");

  const relayer = await fetchRelayerKeys(network);

  const r1 = randomFieldElement();
  const r2 = randomFieldElement();
  const c1 = commitment(userWei, r1, noidZkPublicKey);
  const c2 = commitment(feeWei, r2, relayer.zkPublicKey);

  const encNote1 = encryptNote(
    JSON.stringify({ amount: userWei.toString(), randomness: r1 }),
    noidPublicKey,
    network
  );
  const encNote2 = encryptNote(
    JSON.stringify({ amount: feeWei.toString(), randomness: r2 }),
    relayer.publicKey,
    network
  );

  /* A zero fee disables the relayer note entirely — the pool accepts C2 == 0
     rather than a commitment to nothing. */
  const c2Enabled = feeWei > 0n ? 1 : 0;

  onProving?.();
  const { a, b, c } = await proveDeposit({
    depositAmount: depositWei.toString(),
    c1: c1.decimal,
    c2: c2Enabled ? c2.decimal : "0",
    c2_enabled: String(c2Enabled),
    uc2: relayer.zkPublicKey,
    a1: userWei.toString(),
    r1,
    uc1: noidZkPublicKey,
    a2: c2Enabled ? feeWei.toString() : "0",
    r2: c2Enabled ? r2 : "0",
  });

  const provider = new ethers.JsonRpcProvider(net.rpcUrls[0], {
    name: String(net.chainId),
    chainId: net.chainId,
  });
  const signer = new Wallet(privateKey, provider);
  const pool = new Contract(net.poolAddress, POOL_DEPOSIT_ABI, signer);

  const txReq = await pool.deposit.populateTransaction(
    a,
    b,
    c,
    c1.bytes32,
    c2Enabled ? c2.bytes32 : ethers.ZeroHash,
    encNote1,
    c2Enabled ? encNote2 : "0x",
    { value: depositWei }
  );
  const populated = await signer.populateTransaction(txReq);
  const signedTx = await signer.signTransaction(populated);

  const res = await fetch(`${BASE_URL}/evm/${network}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedTx }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Deposit failed on ${network}.`);
  }

  onSending?.(data.txHash);
  return { hash: data.txHash };
}
