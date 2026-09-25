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
 * The user commitment is the noid account's `zkPublicKey`, and the noid
 * account's `publicKey` (the note-encryption key) goes ON-CHAIN with it in the
 * same register() call. A sender needs both — one locks the note to the
 * receiver, the other encrypts it — and the second cannot be recovered from the
 * first. Keeping it in the backend's database meant every private send depended
 * on a server answering correctly, and a miss there was indistinguishable from
 * "this address never registered", which the send modal ACTS on by falling back
 * to a public withdraw. Reads now go straight to the chain.
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

/** Only these two are needed — the full NoidPool ABI is ~40kB of noise. */
const POOL_REGISTER_ABI = [
  "function register(bytes32 userCommitment, bytes encryptionPublicKey)",
];

/**
 * One eth_call for both halves of a registration. `registrationOf` returns
 * (bytes32(0), "0x") for an address that never registered rather than
 * reverting, so a miss and an unreachable node stay distinguishable.
 */
const POOL_REGISTRATION_ABI = [
  "function registrationOf(address) view returns (bytes32 userCommitment, bytes encryptionPublicKey)",
];

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

const NOT_REGISTERED: RegistrationStatus = {
  registered: false,
  userCommitment: null,
  encryptionPublicKey: null,
};

/** How many times a status lookup is retried before the UI hears about it. */
const STATUS_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hexToBytes = (hex: string) =>
  Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));

async function evmRegistration(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  const net = NETWORKS[network];
  let lastErr: unknown = null;
  /* Every endpoint gets a turn before we conclude anything: Monad's public RPC
     caps at 15 req/sec and answers a rate-limited eth_call with something
     ethers reports as a revert, indistinguishable from a real one. */
  for (const url of net.rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(url, {
        name: String(net.chainId),
        chainId: net.chainId,
      });
      const pool = new Contract(net.poolAddress, POOL_REGISTRATION_ABI, provider);
      const [uc, encKey]: [string, string] = await pool.registrationOf(address);
      if (!uc || BigInt(uc) === 0n) return NOT_REGISTERED;
      return {
        registered: true,
        userCommitment: BigInt(uc).toString(),
        // 65-byte uncompressed secp256k1 key, exactly as the wallet derives it
        encryptionPublicKey: encKey && encKey !== "0x" ? encKey : null,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new RegistryUnavailableError(String((lastErr as any)?.message ?? lastErr));
}

async function solanaRegistration(address: string): Promise<RegistrationStatus> {
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const bs58 = (await import("bs58")).default;
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registration_v2"), new PublicKey(address).toBuffer()],
    new PublicKey(SOLANA_PROGRAM_ID)
  );
  /* The PDA is created BY register() and by nothing else, so a null account is
     the one shape that means "not registered". Anything else throws. */
  const info = await connection.getAccountInfo(pda);
  if (!info) return NOT_REGISTERED;

  // Registration = 8 discriminator + 32 wallet + 32 commitment + 32 encKey + 1 bump
  const data = info.data;
  if (data.length < 8 + 32 + 32 + 32) {
    throw new RegistryUnavailableError(
      `Solana registration account is ${data.length} bytes, expected >= 104`
    );
  }
  return {
    registered: true,
    userCommitment: BigInt(
      "0x" + Buffer.from(data.subarray(40, 72)).toString("hex")
    ).toString(),
    encryptionPublicKey: bs58.encode(Buffer.from(data.subarray(72, 104))),
  };
}

async function aptosRegistration(address: string): Promise<RegistrationStatus> {
  const res = await fetch(`${APTOS_NODE_URL}/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // registration_of answers (false, 0, 0x) instead of aborting on a miss
      function: `${APTOS_MODULE_ADDR}::pool::registration_of`,
      type_arguments: [],
      arguments: [APTOS_POOL_ADDR, address],
    }),
  });
  if (!res.ok) throw new RegistryUnavailableError(`Aptos view: HTTP ${res.status}`);
  const out = await res.json();
  if (!Array.isArray(out)) throw new RegistryUnavailableError("Aptos view returned no tuple");
  const [isRegistered, uc, encKey] = out;
  if (isRegistered !== true) return NOT_REGISTERED;
  return {
    registered: true,
    userCommitment: BigInt(uc).toString(),
    // 32-byte ed25519 key; the wallet stores it as 0x hex
    encryptionPublicKey: encKey && encKey !== "0x" ? encKey : null,
  };
}

async function suiRegistration(address: string): Promise<RegistrationStatus> {
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
  const fields = obj?.result?.data?.content?.fields;
  const ucTable = fields?.registered?.fields?.id?.id;
  const keyTable = fields?.encryption_keys?.fields?.id?.id;
  if (!ucTable) throw new RegistryUnavailableError("Sui pool exposes no registered table");

  /** Returns undefined for a genuine miss; throws when the node won't answer. */
  const lookup = async (tableId: string) => {
    const field = await call("suix_getDynamicFieldObject", [
      tableId,
      { type: "address", value: address },
    ]);
    const err = field?.error ?? field?.result?.error;
    if (err) {
      const code = String((err as any)?.code ?? "");
      /* The miss arrives as an error rather than an empty result — and it is
         the ANSWER: the address simply has no entry in the table. */
      if (code === "dynamicFieldNotFound") return undefined;
      throw new RegistryUnavailableError(String((err as any)?.message ?? code));
    }
    return field?.result?.data?.content?.fields?.value ?? undefined;
  };

  const uc = await lookup(ucTable);
  if (uc === undefined || uc === null) return NOT_REGISTERED;

  const keyBytes = keyTable ? await lookup(keyTable) : undefined;
  return {
    registered: true,
    userCommitment: BigInt(uc as string).toString(),
    // 32-byte ed25519 key; the wallet stores it base64-encoded
    encryptionPublicKey: Array.isArray(keyBytes)
      ? Buffer.from(Uint8Array.from(keyBytes as number[])).toString("base64")
      : null,
  };
}

/** One dispatch point — every caller below reads the chain through this. */
async function registrationFromChain(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  if (EVM_NETWORKS.has(network)) {
    /* Lowercased for EVM: ethers rejects any mixed-case address that is not
       valid EIP-55, and a pasted one is not guaranteed to be. */
    return evmRegistration(network, address.trim().toLowerCase());
  }
  if (network === "solana") return solanaRegistration(address.trim());
  if (network === "aptos") return aptosRegistration(address.trim());
  if (network === "sui") return suiRegistration(address.trim());
  throw new RegistryUnavailableError(`No on-chain registry for ${network}`);
}

/**
 * Registration status for ANY address, read from the chain.
 *
 * Retries before it gives up: testnet RPCs rate-limit, so a single failed
 * lookup says nothing about the recipient — it says the registry was busy for
 * a moment.
 */
export async function fetchRegistrationStatus(
  network: NetworkId,
  address: string
): Promise<RegistrationStatus> {
  let lastDetail = "";
  for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt++) {
    try {
      return await registrationFromChain(network, address);
    } catch (e: any) {
      lastDetail = e?.detail || e?.message || "registry read failed";
      if (attempt < STATUS_ATTEMPTS - 1) await sleep(400 * 2 ** attempt);
    }
  }
  console.error(`[register] status check failed on ${network}:`, lastDetail);
  throw new RegistryUnavailableError(lastDetail);
}


/* ── Register ── */

export async function registerOnChain(
  wallet: StoredWallet,
  network: NetworkId
): Promise<{ txHash: string }> {
  const noid = noidFor(wallet, network);
  const base = baseFor(wallet, network);
  if (!noid || !base) throw new Error(`No ${network} account in this wallet`);

  const userCommitment = noid.zkPublicKey;    // = the user commitment
  const encryptionPublicKey = noid.publicKey; // goes on-chain with it
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
    const txReq = await pool.register.populateTransaction(uc, encryptionPublicKey);
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
      [Buffer.from("registration_v2"), user.publicKey.toBuffer()],
      programId
    );

    // register(user_commitment: [u8; 32], encryption_public_key: [u8; 32]) —
    // fixed-size arrays are written raw, with no length prefix, one after the
    // other straight after the discriminator.
    const data = Buffer.concat([
      Buffer.from(anchorDiscriminator("register")),
      Buffer.from(toBE32(userCommitment)),
      Buffer.from(bs58.decode(encryptionPublicKey)),
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
      arguments: [
        tx.object(SUI_POOL_STATE_ID),
        tx.pure.u256(BigInt(userCommitment)),
        tx.pure.vector(
          "u8",
          Array.from(Uint8Array.from(Buffer.from(encryptionPublicKey, "base64")))
        ),
      ],
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
        functionArguments: [
          APTOS_POOL_ADDR,
          BigInt(userCommitment),
          Array.from(hexToBytes(encryptionPublicKey)),
        ],
      },
    });
    const senderAuthenticator = aptos.transaction.sign({ signer: account, transaction });
    const signed = generateSignedTransaction({ transaction, senderAuthenticator });
    body = { signedTxn: "0x" + Buffer.from(signed).toString("hex") };
  } else {
    throw new Error(`Unknown network ${network}`);
  }

  /* The backend only BROADCASTS this transaction — everything a sender needs is
     inside it and lands on-chain. The fields below are mirrored into its
     database for support lookups; nothing reads them back on the send path. */
  const res = await fetch(`${BASE_URL}/register/${network}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      address: base.address,
      userCommitment,
      encryptionPublicKey,
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
 * "Is this wallet registered?" — ASKED OF THE CHAIN, not of the backend.
 *
 * Shares the exact reader the send path uses, so Verify and the send modal can
 * never disagree about what "registered" means on a given chain.
 */
export async function isRegisteredOnChain(
  wallet: StoredWallet,
  network: NetworkId
): Promise<boolean> {
  const base = baseFor(wallet, network);
  if (!base) return false;
  const status = await registrationFromChain(network, base.address);
  return status.registered;
}

/**
 * "Already registered?" repair: verify on-chain and, if registered, mark the
 * local cache so the chain drops out of the register selector.
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
