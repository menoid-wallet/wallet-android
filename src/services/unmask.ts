/**
 * unmask.ts — "unhide": spending notes back out to a public address.
 *
 * Ported from the extension's services/unmask.ts, EVM half.
 *
 * The shape, because it is not obvious: notes are spent in BATCHES OF FOUR.
 * The withdraw circuit takes exactly MAX_INPUTS slots, so a wallet holding nine
 * notes needs three proofs, and each proof takes tens of seconds — this is the
 * single biggest difference from Hide, which is always one proof. The relayer
 * fee is taken from the FIRST batches that can cover it, and whatever is left
 * over after the withdrawal comes back as a change note to yourself.
 *
 * Nothing here is signed by the user: the finished calls go to the backend,
 * which submits them, so the RELAYER is the on-chain sender. That is the point
 * — a withdraw signed by your own address would tie the note to you and undo
 * the privacy you paid for. The relayer is compensated by the fee note.
 */

import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";
import { encryptNote } from "../crypto/ecies";
import type { MerkleProof } from "../lib/merkleTree";
import { type NetworkId } from "../lib/networks";
import { BASE_URL } from "./api";
import { fetchRelayerKeys, type RelayerKeys } from "./mask";
import { proveCircuit } from "./zk";

const MAX_INPUTS = 4;
const TREE_DEPTH = 20;
const ZERO_HASH = "0x" + "0".repeat(64);
const SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** What the relayer charges to carry a withdraw. Much larger than a mask. */
export function withdrawFeeFor(network: NetworkId): string {
  if (network === "monad") return "0.2";
  return network === "sepolia" || network === "base_sepolia" ? "0.5" : "0.0001";
}

export interface PoolNote {
  commitment: string;
  amount: string;
  randomness: string;
  leafIndex: number;
  poolId: string;
}

function randomR(): string {
  const b = new Uint8Array(31);
  (globalThis.crypto as Crypto).getRandomValues(b);
  let hex = "0x";
  for (const x of b) hex += x.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

function commitment(amount: bigint, randomness: string, zkPublicKey: string) {
  const c = poseidon4([1n, amount, BigInt(randomness), BigInt(zkPublicKey)]);
  return { decimal: c.toString(), bytes32: ethers.zeroPadValue(ethers.toBeHex(c), 32) };
}

function toBytes32(dec: string): string {
  return ethers.zeroPadValue(ethers.toBeHex(BigInt(dec)), 32);
}

/** EVM addresses fit in the field as-is; the wider chains must be reduced. */
function addressToField(addr: string): string {
  return (BigInt(addr) % SCALAR_FIELD).toString();
}

/**
 * Split the notes into batches and decide what each one pays out.
 *
 * The fee comes off the front, then the withdrawal, then whatever remains is
 * change back to the sender. Returns null when the notes cannot cover both —
 * the caller must treat that as "not enough", never as an empty plan.
 */
export function planWithdraw(
  notes: PoolNote[],
  withdrawWei: bigint,
  feeWei: bigint
): { plans: { inputs: PoolNote[]; withdrawAmt: bigint; changeAmt: bigint; feeAmt: bigint }[] } | null {
  const sorted = [...notes].sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1));
  const need = withdrawWei + feeWei;

  const chosen: PoolNote[] = [];
  let total = 0n;
  for (const n of sorted) {
    if (total >= need) break;
    chosen.push(n);
    total += BigInt(n.amount);
  }
  if (total < need) return null;

  const batches: PoolNote[][] = [];
  const flat = [...chosen];
  while (flat.length) batches.push(flat.splice(0, MAX_INPUTS));

  const plans: { inputs: PoolNote[]; withdrawAmt: bigint; changeAmt: bigint; feeAmt: bigint }[] = [];
  let withdrawLeft = withdrawWei;
  let feeLeft = feeWei;

  for (const batch of batches) {
    const batchTotal = batch.reduce((s, u) => s + BigInt(u.amount), 0n);
    const feeAmt = batchTotal >= feeLeft ? feeLeft : batchTotal;
    feeLeft -= feeAmt;
    const available = batchTotal - feeAmt;
    const toWithdraw = withdrawLeft <= available ? withdrawLeft : available;
    withdrawLeft -= toWithdraw;
    plans.push({ inputs: batch, withdrawAmt: toWithdraw, changeAmt: available - toWithdraw, feeAmt });
  }

  if (withdrawLeft > 0n || feeLeft > 0n) return null;
  return { plans };
}

interface Sender {
  zkSecretKey: string;
  zkPublicKey: string;
  noidPublicKey: string;
  ownerAddress: string;
}

/** One batch → one groth16 proof and the call the pool wants. */
async function buildWithdrawCall(
  inputs: PoolNote[],
  withdrawAmt: bigint,
  changeAmt: bigint,
  feeAmt: bigint,
  toAddress: string,
  sender: Sender,
  relayer: RelayerKeys,
  network: NetworkId,
  getMerkleProof: (poolId: string, leafIndex: number) => MerkleProof | null
) {
  const padded: (PoolNote | null)[] = [...inputs];
  while (padded.length < MAX_INPUTS) padded.push(null);

  const enabled: number[] = [];
  const c_ins: string[] = [];
  const a_ins: string[] = [];
  const r_ins: string[] = [];
  const roots: string[] = [];
  const pathElements: string[][] = [];
  const pathIndices: number[][] = [];
  const nullifiers: string[] = [];
  const poolIds: number[] = [];
  const rootsBytes32: string[] = [];
  const nullifiersBytes32: string[] = [];

  for (const note of padded) {
    if (!note) {
      // An unused slot still has to be a well-formed zero — the circuit reads
      // all four and switches on `enabled`.
      enabled.push(0);
      c_ins.push("0");
      a_ins.push("0");
      r_ins.push("0");
      roots.push("0");
      pathElements.push(Array(TREE_DEPTH).fill("0"));
      pathIndices.push(Array(TREE_DEPTH).fill(0));
      nullifiers.push("0");
      poolIds.push(0);
      rootsBytes32.push(ZERO_HASH);
      nullifiersBytes32.push(ZERO_HASH);
      continue;
    }

    const proof = getMerkleProof(note.poolId, note.leafIndex);
    if (!proof) {
      throw new Error(`No Merkle proof for leaf ${note.leafIndex} in pool ${note.poolId}.`);
    }

    /* The nullifier is what stops a note being spent twice, and it is derived
       from the SPENDING KEY — which is why only the owner can produce it and
       why it reveals nothing about which note it belongs to. */
    const nullifier = poseidon4([
      2n,
      BigInt(note.commitment),
      BigInt(note.randomness),
      BigInt(sender.zkSecretKey),
    ]).toString();

    enabled.push(1);
    c_ins.push(BigInt(note.commitment).toString());
    a_ins.push(note.amount);
    r_ins.push(note.randomness);
    roots.push(proof.root);
    pathElements.push(proof.siblings);
    pathIndices.push(proof.pathIndices);
    nullifiers.push(nullifier);
    poolIds.push(Number(note.poolId) || 0);
    rootsBytes32.push(toBytes32(proof.root));
    nullifiersBytes32.push(toBytes32(nullifier));
  }

  const rChange = randomR();
  const rRelayer = randomR();
  const changeEnabled = changeAmt > 0n ? 1 : 0;
  const relayerEnabled = feeAmt > 0n ? 1 : 0;

  const changeCommitment = commitment(changeAmt, rChange, sender.zkPublicKey);
  const relayerCommitment = commitment(feeAmt, rRelayer, relayer.zkPublicKey);

  const encryptedNote1 = encryptNote(
    JSON.stringify({ amount: changeAmt.toString(), randomness: rChange }),
    sender.noidPublicKey,
    network
  );
  const encryptedNote2 = encryptNote(
    JSON.stringify({ amount: feeAmt.toString(), randomness: rRelayer }),
    relayer.publicKey,
    network
  );

  const { a, b, c } = await proveCircuit("withdraw", {
    sk: sender.zkSecretKey,
    owner_address: addressToField(sender.ownerAddress),
    receiver: addressToField(toAddress),
    changeReceiver: sender.zkPublicKey,
    relayer: relayer.zkPublicKey,
    enabled,
    c_ins,
    a_ins,
    r_ins,
    roots,
    pathElements,
    pathIndices,
    nullifiers,
    withdrawAmount: withdrawAmt.toString(),
    out_enabled: [changeEnabled, relayerEnabled],
    a_outs: [changeAmt.toString(), feeAmt.toString()],
    r_outs: [rChange, rRelayer],
    c_outs: [
      changeEnabled ? changeCommitment.decimal : "0",
      relayerEnabled ? relayerCommitment.decimal : "0",
    ],
    receivers: [sender.zkPublicKey, relayer.zkPublicKey],
  });

  return {
    a,
    b,
    c,
    inputs: { enabled, roots: rootsBytes32, poolIds, nullifiers: nullifiersBytes32 },
    C1: changeEnabled ? changeCommitment.bytes32 : ZERO_HASH,
    C2: relayerEnabled ? relayerCommitment.bytes32 : ZERO_HASH,
    c1Decimal: changeEnabled ? changeCommitment.decimal : "0",
    c2Decimal: relayerEnabled ? relayerCommitment.decimal : "0",
    encryptedNote1,
    encryptedNote2,
    withdrawAmount: withdrawAmt.toString(),
  };
}

export interface UnmaskArgs {
  /** decimal amount to send out */
  withdrawAmount: string;
  toAddress: string;
  network: NetworkId;
  notes: PoolNote[];
  sender: Sender;
  getMerkleProof: (poolId: string, leafIndex: number) => MerkleProof | null;
  onBatch?: (n: number, total: number) => void;
  onSending?: (hash: string) => void;
}

export async function executeUnmask({
  withdrawAmount,
  toAddress,
  network,
  notes,
  sender,
  getMerkleProof,
  onBatch,
  onSending,
}: UnmaskArgs): Promise<{ hash: string }> {
  const withdrawWei = ethers.parseEther(withdrawAmount);
  const feeWei = ethers.parseEther(withdrawFeeFor(network));

  const planned = planWithdraw(notes, withdrawWei, feeWei);
  if (!planned) {
    throw new Error(
      `Not enough in the pool — this needs ${ethers.formatEther(withdrawWei + feeWei)} including the relayer fee.`
    );
  }

  const relayer = await fetchRelayerKeys(network);
  const calls: unknown[] = [];

  for (let i = 0; i < planned.plans.length; i++) {
    onBatch?.(i + 1, planned.plans.length);
    const p = planned.plans[i];
    calls.push(
      await buildWithdrawCall(
        p.inputs,
        p.withdrawAmt,
        p.changeAmt,
        p.feeAmt,
        toAddress,
        sender,
        relayer,
        network,
        getMerkleProof
      )
    );
  }

  const res = await fetch(`${BASE_URL}/evm/${network}/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ withdrawCalls: calls, to: toAddress }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Unhide failed on ${network}.`);

  onSending?.(data.txHash);
  return { hash: data.txHash };
}
