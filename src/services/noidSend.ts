/**
 * noidSend.ts — a private transfer: pool note → someone else's pool note.
 *
 * Ported from the extension's NoidSendModal transfer path, EVM half.
 *
 * Three notes come out of every batch: one to the RECIPIENT, one of change back
 * to you, and one paying the RELAYER. Each is encrypted to its owner's noid key,
 * so only they can ever spend it — and the recipient learns their note exists by
 * trial-decrypting the pool, which is why they never had to be online.
 *
 * MONAD IS FREE. `feePerCall` is 0 there, and when the fee is zero the third
 * note is disabled entirely rather than being a commitment to nothing — the
 * circuit and the pool both accept C3 == 0. That is a real difference in the
 * proof, not just a display detail.
 *
 * Like unhide, notes are spent four at a time, so a wallet with many small
 * notes pays a fee PER BATCH and proves once per batch.
 */

import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";
import { encryptNote } from "../crypto/ecies";
import type { MerkleProof } from "../lib/merkleTree";
import { type NetworkId } from "../lib/networks";
import { BASE_URL } from "./api";
import { fetchRelayerKeys, type RelayerKeys } from "./mask";
import { fetchRegistrationStatus } from "./register";
import { proveCircuit } from "./zk";
import type { PoolNote } from "./unmask";

const MAX_INPUTS = 4;
const TREE_DEPTH = 20;
const ZERO_HASH = "0x" + "0".repeat(64);
const SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** What the relayer charges PER BATCH. Monad is free. */
export function feePerCallFor(network: NetworkId): string {
  if (network === "monad") return "0";
  if (network === "base_sepolia") return "0.00005";
  if (network === "sepolia") return "0.003";
  return "0.0001";
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

const toBytes32 = (d: string) => ethers.zeroPadValue(ethers.toBeHex(BigInt(d)), 32);
const addressToField = (a: string) => (BigInt(a) % SCALAR_FIELD).toString();

export interface Recipient {
  /** the noid ENCRYPTION key — what their note is sealed to */
  ecPublicKey: string;
  /** their user commitment — what the circuit pays to */
  zkPublicKey: string;
}

/**
 * Resolve a real wallet address to its private identity.
 *
 * The sender types an ordinary address; the pool pays a commitment. If the
 * address has never registered there is nothing to pay to — the caller has to
 * decide what to do about that, so this reports it rather than guessing.
 */
export async function resolveRecipient(
  network: NetworkId,
  address: string
): Promise<{ registered: boolean; recipient: Recipient | null }> {
  const s = await fetchRegistrationStatus(network, address);
  if (!s.registered || !s.userCommitment || !s.encryptionPublicKey) {
    return { registered: false, recipient: null };
  }
  return {
    registered: true,
    recipient: { ecPublicKey: s.encryptionPublicKey, zkPublicKey: s.userCommitment },
  };
}

interface Sender {
  zkSecretKey: string;
  zkPublicKey: string;
  noidPublicKey: string;
  ownerAddress: string;
}

/** Batch the notes; every batch carries its own fee. */
export function planTransfer(
  notes: PoolNote[],
  sendWei: bigint,
  feePerCallWei: bigint
): { plans: { inputs: PoolNote[]; receiverAmt: bigint; changeAmt: bigint; feeAmt: bigint }[] } | null {
  const sorted = [...notes].sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1));

  /* The fee depends on how many batches we end up with, and the batch count
     depends on how many notes we take — so grow the selection until it covers
     the amount PLUS the fee for the batches that selection implies. */
  const chosen: PoolNote[] = [];
  let total = 0n;
  for (const n of sorted) {
    const batches = BigInt(Math.max(1, Math.ceil(chosen.length / MAX_INPUTS)));
    if (total >= sendWei + feePerCallWei * batches) break;
    chosen.push(n);
    total += BigInt(n.amount);
  }
  const batchCount = BigInt(Math.max(1, Math.ceil(chosen.length / MAX_INPUTS)));
  if (total < sendWei + feePerCallWei * batchCount) return null;

  const batches: PoolNote[][] = [];
  const flat = [...chosen];
  while (flat.length) batches.push(flat.splice(0, MAX_INPUTS));

  const plans: { inputs: PoolNote[]; receiverAmt: bigint; changeAmt: bigint; feeAmt: bigint }[] = [];
  let sendLeft = sendWei;

  for (const batch of batches) {
    const batchTotal = batch.reduce((s, u) => s + BigInt(u.amount), 0n);
    const feeAmt = feePerCallWei <= batchTotal ? feePerCallWei : batchTotal;
    const available = batchTotal - feeAmt;
    const toSend = sendLeft <= available ? sendLeft : available;
    sendLeft -= toSend;
    plans.push({ inputs: batch, receiverAmt: toSend, changeAmt: available - toSend, feeAmt });
  }

  if (sendLeft > 0n) return null;
  return { plans };
}

async function buildTransferCall(
  inputs: PoolNote[],
  receiverAmt: bigint,
  changeAmt: bigint,
  feeAmt: bigint,
  recipient: Recipient,
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
    if (!proof) throw new Error(`No Merkle proof for leaf ${note.leafIndex}.`);

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

  const isFree = feeAmt === 0n;
  const rR = randomR();
  const rC = randomR();
  const rRel = randomR();
  const rE = receiverAmt > 0n ? 1 : 0;
  const cE = changeAmt > 0n ? 1 : 0;
  const fE = isFree ? 0 : 1;

  const rCom = commitment(receiverAmt, rR, recipient.zkPublicKey);
  const cCom = commitment(changeAmt, rC, sender.zkPublicKey);
  const fCom = isFree ? null : commitment(feeAmt, rRel, relayer.zkPublicKey);

  const n1 = encryptNote(
    JSON.stringify({ amount: receiverAmt.toString(), randomness: rR }),
    recipient.ecPublicKey,
    network
  );
  const n2 = encryptNote(
    JSON.stringify({ amount: changeAmt.toString(), randomness: rC }),
    sender.noidPublicKey,
    network
  );
  // No fee note at all on a free chain — "0x", not an encryption of zero.
  const n3 = isFree
    ? "0x"
    : encryptNote(
        JSON.stringify({ amount: feeAmt.toString(), randomness: rRel }),
        relayer.publicKey,
        network
      );

  const { a, b, c, proof } = await proveCircuit("transfer", {
    sk: sender.zkSecretKey,
    owner_address: addressToField(sender.ownerAddress),
    relayer: relayer.zkPublicKey,
    enabled,
    c_ins,
    a_ins,
    r_ins,
    roots,
    pathElements,
    pathIndices,
    nullifiers,
    output_enabled: [rE, cE, fE],
    c_outs: [rE ? rCom.decimal : "0", cE ? cCom.decimal : "0", fE && fCom ? fCom.decimal : "0"],
    a_outs: [receiverAmt.toString(), changeAmt.toString(), feeAmt.toString()],
    r_outs: [rR, rC, rRel],
    receivers: [recipient.zkPublicKey, sender.zkPublicKey, relayer.zkPublicKey],
  });

  return {
    zkProof: proof,
    call: {
    a,
    b,
    c,
    inputs: { enabled, roots: rootsBytes32, poolIds, nullifiers: nullifiersBytes32 },
    C1: rE ? rCom.bytes32 : ZERO_HASH,
    C2: cE ? cCom.bytes32 : ZERO_HASH,
    C3: fE && fCom ? fCom.bytes32 : ZERO_HASH,
    c1Decimal: rE ? rCom.decimal : "0",
    c2Decimal: cE ? cCom.decimal : "0",
    c3Decimal: fE && fCom ? fCom.decimal : "0",
    encryptedNote1: n1,
    encryptedNote2: n2,
    encryptedNote3: n3,
    },
  };
}

export interface NoidSendArgs {
  amount: string;
  network: NetworkId;
  recipient: Recipient;
  notes: PoolNote[];
  sender: Sender;
  getMerkleProof: (poolId: string, leafIndex: number) => MerkleProof | null;
  onBatch?: (n: number, total: number) => void;
  onSending?: (hash: string) => void;
}

export async function executeNoidSend({
  amount,
  network,
  recipient,
  notes,
  sender,
  getMerkleProof,
  onBatch,
  onSending,
}: NoidSendArgs): Promise<{ hash: string }> {
  const sendWei = ethers.parseEther(amount);
  const feeWei = ethers.parseEther(feePerCallFor(network));

  const planned = planTransfer(notes, sendWei, feeWei);
  if (!planned) throw new Error("Not enough in the pool to cover this and the relayer fee.");

  const relayer = await fetchRelayerKeys(network);
  const transferCalls: unknown[] = [];
  const zkProofs: unknown[] = [];

  for (let i = 0; i < planned.plans.length; i++) {
    onBatch?.(i + 1, planned.plans.length);
    const p = planned.plans[i];
    const built = await buildTransferCall(
        p.inputs,
        p.receiverAmt,
        p.changeAmt,
        p.feeAmt,
        recipient,
        sender,
        relayer,
        network,
        getMerkleProof
      );
    transferCalls.push(built.call);
    zkProofs.push(built.zkProof);
  }

  /* Note the route: transfers go to /transfer/:network/transfer, NOT the
     /evm/:network/… family the deposit and withdraw use. */
  const res = await fetch(`${BASE_URL}/transfer/${network}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transferCalls, zkProofs }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Private send failed on ${network}.`);

  onSending?.(data.txHash);
  return { hash: data.txHash };
}
