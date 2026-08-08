/**
 * register.ts — binding a wallet to a private identity, per chain.
 *
 * Ported from the extension's services/register.ts. The shape is unusual and
 * worth stating: the REAL wallet signs the register transaction locally, and
 * the SIGNED BYTES are POSTed to the backend, which broadcasts. It has to be
 * signed here because the on-chain `registered` map is keyed by msg.sender —
 * the backend cannot register on the user's behalf — and it is relayed rather
 * than sent because the wallet has no indexer of its own.
 *
 * The user commitment is the noid account's `zkPublicKey`. The noid account's
 * `publicKey` (the ECIES encryption key) goes along in the POST body so the
 * backend can store it off-chain: a sender needs it to encrypt a note to this
 * wallet, and it cannot be recovered from the commitment.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE EXTENSION: Solana's instruction is built
 * by hand instead of through @coral-xyz/anchor. Anchor pulls a large dependency
 * tree onto the phone to produce eight discriminator bytes and a 32-byte
 * argument, and its Node-oriented build does not sit well in React Native. The
 * encoding it would emit is reproduced directly below and is asserted against
 * the real IDL in scripts/verify-register-ix.cjs.
 */

import { ethers, Contract, Wallet } from "ethers";
import { sha256 } from "@noble/hashes/sha2";
import { Buffer } from "buffer";
import { BASE_URL } from "./api";
import {
  APTOS_MODULE_ADDR,
  APTOS_NODE_URL,
  APTOS_POOL_ADDR,
  SOLANA_PROGRAM_ID,
  SOLANA_RPC,
  SUI_PACKAGE_ID,
  SUI_POOL_STATE_ID,
  SUI_RPC,
} from "../lib/config";
import { NETWORKS, type NetworkId } from "../lib/networks";
import { setChainRegistered } from "../lib/registration";
import type { StoredWallet } from "../crypto/walletCrypto";

/* EVERY CHAIN SDK IS LOADED LAZILY, and that is not an optimisation — it is
   the difference between the app starting and not. This module is reachable
   from WalletHome (RegisterView → NoidModeView), so a static import of the
   Solana, Sui and Aptos SDKs put all three into the FIRST bundle evaluation,
   and one of them threw "undefined cannot be used as a constructor" before the
   runtime was even ready: a white screen on launch. lib/rpc.ts loads them the
   same way for the same reason. */

/** Only the one function is needed — the full NoidPool ABI is ~40kB of noise. */
const POOL_REGISTER_ABI = ["function register(bytes32 userCommitment)"];

const EVM_NETWORKS = new Set<NetworkId>(["monad", "sepolia", "base_sepolia"]);

function noidFor(w: StoredWallet, n: NetworkId) {
  if (n === "solana") return w.solanaNoidAccount;
  if (n === "sui") return w.suiNoidAccount;
  if (n === "aptos") return w.aptosNoidAccount;
  return w.noidAccount;
}

function baseFor(w: StoredWallet, n: NetworkId) {
  if (n === "solana") return w.solanaAccount;
  if (n === "sui") return w.suiAccount;
  if (n === "aptos") return w.aptosAccount;
  return w.normalAccount;
}

/** 32-byte big-endian — how the commitment is passed to the Solana program. */
function toBE32(value: string): Uint8Array {
  let v = BigInt(value);
  const buf = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/** Anchor's method discriminator: first 8 bytes of sha256("global:<name>"). */
function anchorDiscriminator(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
}

/* ── On-chain status ── */

export interface RegistrationStatus {
  registered: boolean;
  userCommitment: string | null;
  encryptionPublicKey: string | null;
}

export async function fetchRegistrationStatus(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  /* Lowercased for EVM. The backend runs the address through ethers, which
     rejects any mixed-case address that is not valid EIP-55 — and the stored
     form is not guaranteed to be. Lowercase always parses. */
  const addr = EVM_NETWORKS.has(network) ? address.trim().toLowerCase() : address.trim();
  const res = await fetch(`${BASE_URL}/register/${network}/status/${addr}`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Failed to check registration on ${network}`);
  }
  return {
    registered: !!data.registered,
    userCommitment: data.userCommitment ?? null,
    encryptionPublicKey: data.encryptionPublicKey ?? null,
  };
}

/* ── Register ── */

export async function registerOnChain(
  wallet: StoredWallet,
  network: NetworkId
): Promise<{ txHash: string }> {
  const noid = noidFor(wallet, network);
  const base = baseFor(wallet, network);
  if (!noid || !base) throw new Error(`No ${network} account in this wallet`);

  const userCommitment = noid.zkPublicKey;
  let body: Record<string, unknown>;

  if (EVM_NETWORKS.has(network)) {
    const net = NETWORKS[network];
    const provider = new ethers.JsonRpcProvider(net.rpcUrls[0], {
      name: String(net.chainId),
      chainId: net.chainId,
    });
    const signer = new Wallet(base.privateKey, provider);
    const pool = new Contract(net.poolAddress, POOL_REGISTER_ABI, signer);
    const uc = ethers.zeroPadValue(ethers.toBeHex(BigInt(userCommitment)), 32);
    const txReq = await pool.register.populateTransaction(uc);
    const populated = await signer.populateTransaction(txReq);
    body = { signedTx: await signer.signTransaction(populated) };
  } else if (network === "solana") {
    const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } =
      await import("@solana/web3.js");
    const bs58 = (await import("bs58")).default;
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const user = Keypair.fromSecretKey(bs58.decode(base.privateKey));
    const programId = new PublicKey(SOLANA_PROGRAM_ID);
    const [registrationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registration"), user.publicKey.toBuffer()],
      programId
    );

    // register(user_commitment: [u8; 32]) — a fixed-size array is written raw,
    // with no length prefix, straight after the discriminator.
    const data = Buffer.concat([
      Buffer.from(anchorDiscriminator("register")),
      Buffer.from(toBE32(userCommitment)),
    ]);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: registrationPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = user.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(user);
    body = { serializedTx: Buffer.from(tx.serialize()).toString("hex") };
  } else if (network === "sui") {
    const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");
    const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
    const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
    const { Transaction: SuiTransaction } = await import("@mysten/sui/transactions");
    const { toBase64 } = await import("@mysten/bcs");
    const client = new SuiJsonRpcClient({ url: SUI_RPC, network: "testnet" });
    const seed = base.privateKey.startsWith("suiprivkey")
      ? decodeSuiPrivateKey(base.privateKey).secretKey
      : Uint8Array.from(Buffer.from(base.privateKey, "base64"));
    const keypair = Ed25519Keypair.fromSecretKey(seed);

    const tx = new SuiTransaction();
    tx.moveCall({
      target: `${SUI_PACKAGE_ID}::pool::register`,
      arguments: [tx.object(SUI_POOL_STATE_ID), tx.pure.u256(BigInt(userCommitment))],
    });
    tx.setSender(keypair.getPublicKey().toSuiAddress());
    const txBytes = await tx.build({ client: client as any });
    const { signature } = await keypair.signTransaction(txBytes);
    body = { txBytes: toBase64(txBytes), signature };
  } else if (network === "aptos") {
    const { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network, generateSignedTransaction } =
      await import("@aptos-labs/ts-sdk");
    const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET, fullnode: APTOS_NODE_URL }));
    const account = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(base.privateKey.replace(/^0x/, "")),
    });
    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: `${APTOS_MODULE_ADDR}::pool::register` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [APTOS_POOL_ADDR, BigInt(userCommitment)],
      },
    });
    const senderAuthenticator = aptos.transaction.sign({ signer: account, transaction });
    const signed = generateSignedTransaction({ transaction, senderAuthenticator });
    body = { signedTxn: "0x" + Buffer.from(signed).toString("hex") };
  } else {
    throw new Error(`Unknown network ${network}`);
  }

  const res = await fetch(`${BASE_URL}/register/${network}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      address: base.address,
      userCommitment,
      encryptionPublicKey: noid.publicKey,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Registration failed on ${network}`);
  }

  await setChainRegistered(base.address, network, true);
  return { txHash: data.txHash };
}

/**
 * "Already registered?" — ask the chain and repair the local cache.
 *
 * The case this exists for: the same seed phrase registered on another device.
 * The chain says yes, this install has never heard of it, and without a repair
 * path the user would be asked to pay for a registration they already have.
 */
export async function verifyAndRepair(
  wallet: StoredWallet,
  network: NetworkId
): Promise<boolean> {
  const base = baseFor(wallet, network);
  if (!base) return false;
  const status = await fetchRegistrationStatus(network, base.address);
  if (status.registered) {
    await setChainRegistered(base.address, network, true);
    return true;
  }
  return false;
}
