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

/**
 * Thrown when the registry could not be ASKED — as opposed to answering "no".
 *
 * A definitive `registered: false` is a normal answer the UI can act on. An
 * unreachable registry is not, and must never be mistaken for one: the
 * recipient may well be registered, and treating "don't know" as "no" is how a
 * privacy wallet ends up doing something in the clear by accident.
 */
export class RegistryUnavailableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super("Couldn't reach the private registry. Try again in a moment.");
    this.name = "RegistryUnavailableError";
    this.detail = detail;
  }
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    /* The body is an ethers CALL_EXCEPTION dump when the backend's pool address
       is wrong for the chain — hundreds of characters of calldata, which the
       register page would otherwise render into an 8pt label under a chain
       tile. Console gets the detail, the UI gets a sentence. */
    const detail = data?.message || `HTTP ${res.status} from /register/${network}/status`;
    console.error(`[register] status check failed on ${network}:`, detail);
    throw new RegistryUnavailableError(detail);
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

/** Just the getter — `registered(addr)` returns 0x00…00 when it is not. */
const POOL_REGISTERED_ABI = ["function registered(address) view returns (bytes32)"];

/**
 * "Is this wallet registered?" — ASKED OF THE CHAIN, not of the backend.
 *
 * This is an on-chain fact and it should never have needed a server. Routing it
 * through /register/:net/status meant Verify inherited every problem that
 * endpoint has, and it currently has four different ones — a pool address with
 * no contract behind it on Sepolia and Base, a stale Aptos module, and Sui's
 * JSON-RPC being switched off. Verify only needs a yes/no, and every chain can
 * answer that directly from config this app already holds.
 *
 * SUI NEEDS THE RIGHT ENDPOINT, not a different protocol. Sui switched JSON-RPC
 * off on its PUBLIC FULLNODES — every method, not a subset — which is the wall
 * the backend hit and reported as "migrate to gRPC or GraphQL". The provider in
 * `SUI_RPC` still serves the whole interface, so the read is perfectly possible
 * from here: find the pool's `registered` Table and look the address up as a
 * dynamic field. `dynamicFieldNotFound` is the definitive no.
 */
export async function isRegisteredOnChain(
  wallet: StoredWallet,
  network: NetworkId
): Promise<boolean> {
  const base = baseFor(wallet, network);
  if (!base) return false;

  if (EVM_NETWORKS.has(network)) {
    const net = NETWORKS[network];
    let lastErr: unknown = null;
    for (const url of net.rpcUrls) {
      try {
        const provider = new ethers.JsonRpcProvider(url, {
          name: String(net.chainId),
          chainId: net.chainId,
        });
        const pool = new Contract(net.poolAddress, POOL_REGISTERED_ABI, provider);
        const commitment: string = await pool.registered(base.address);
        return !!commitment && BigInt(commitment) !== 0n;
      } catch (e) {
        lastErr = e; // try the next endpoint before giving up
      }
    }
    throw new RegistryUnavailableError(String((lastErr as any)?.message ?? lastErr));
  }

  if (network === "solana") {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registration"), new PublicKey(base.address).toBuffer()],
      new PublicKey(SOLANA_PROGRAM_ID)
    );
    // The PDA is created BY register() and by nothing else, so its existence
    // is the registration.
    return (await connection.getAccountInfo(pda)) !== null;
  }

  if (network === "aptos") {
    const res = await fetch(`${APTOS_NODE_URL}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        function: `${APTOS_MODULE_ADDR}::pool::is_registered`,
        type_arguments: [],
        arguments: [APTOS_POOL_ADDR, base.address],
      }),
    });
    if (!res.ok) throw new RegistryUnavailableError(`Aptos view: HTTP ${res.status}`);
    const out = await res.json();
    return out?.[0] === true;
  }

  if (network === "sui") {
    const call = async (method: string, params: unknown[]) => {
      const res = await fetch(SUI_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) throw new RegistryUnavailableError(`Sui RPC HTTP ${res.status}`);
      return res.json();
    };

    const obj = await call("sui_getObject", [SUI_POOL_STATE_ID, { showContent: true }]);
    if (obj?.error) throw new RegistryUnavailableError(String(obj.error?.message ?? obj.error));
    const tableId = obj?.result?.data?.content?.fields?.registered?.fields?.id?.id;
    if (!tableId) throw new RegistryUnavailableError("Sui pool exposes no registered table");

    const field = await call("suix_getDynamicFieldObject", [
      tableId,
      { type: "address", value: base.address },
    ]);
    // The miss arrives as an error rather than an empty result, and it is the
    // ANSWER — the address simply has no entry in the table.
    const err = field?.error ?? field?.result?.error;
    if (err) {
      const code = String(err?.code ?? "");
      if (code === "dynamicFieldNotFound") return false;
      throw new RegistryUnavailableError(String(err?.message ?? code));
    }
    return !!field?.result?.data;
  }

  throw new RegistryUnavailableError(`No on-chain check for ${network}`);
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
  if (await isRegisteredOnChain(wallet, network)) {
    await setChainRegistered(base.address, network, true);
    return true;
  }
  return false;
}
