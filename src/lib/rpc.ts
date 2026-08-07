/**
 * rpc.ts — read-only chain access for the wallet home.
 *
 * Ported from the extension's lib/rpc.ts, with ONE deliberate difference: the
 * extension leaned on ethers' JsonRpcProvider for EVM and on the @solana/web3.js
 * client for Solana. Neither earns its weight on a phone — a provider carries a
 * polling/event machine this screen never uses, and pulling web3.js in for a
 * single `getBalance` would add a large native-hostile dependency. So every
 * chain here is a plain `fetch` against the SAME endpoints the extension uses,
 * with the same per-chain quirks:
 *
 *   EVM     → eth_getBalance, wei, walked down the rpcUrls fallback list
 *   Solana  → getBalance, lamports / 1e9
 *   Sui     → suix_getBalance, totalBalance (MIST) / 1e9
 *   Aptos   → the `0x1::coin::balance` VIEW function, octas / 1e8. Not the
 *             CoinStore resource: APT moved to the Fungible Asset standard and
 *             newer accounts hold no CoinStore at all.
 *
 * The returned decimal strings are identical to the extension's, so the same
 * formatting and the same USD maths land on the same numbers.
 */

import { ethers, formatEther, JsonRpcProvider, Network, Wallet } from "ethers";
import { NETWORKS, type NetworkConfig, type NetworkId } from "./networks";

const RPC_TIMEOUT_MS = 12_000;

/** fetch + JSON, with a timeout so one dead endpoint can't stall the poll. */
async function postJson(url: string, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* Remembers which endpoint last worked per chain, so a chain whose first RPC is
   down doesn't pay the failed request again on every 6s poll. */
const activeIdx: Partial<Record<NetworkId, number>> = {};

async function withFallback<T>(
  net: NetworkConfig,
  fn: (url: string) => Promise<T>
): Promise<T> {
  const start = activeIdx[net.id] ?? 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < net.rpcUrls.length; attempt++) {
    const i = (start + attempt) % net.rpcUrls.length;
    try {
      const out = await fn(net.rpcUrls[i]);
      activeIdx[net.id] = i;
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`All RPC endpoints failed for ${net.id}`);
}

/** Native balance, formatted as a decimal string (e.g. "1.2345"). */
export async function getBalance(
  address: string,
  networkId: NetworkId = "monad"
): Promise<string> {
  if (networkId === "solana") {
    const json = await postJson(NETWORKS.solana.rpcUrls[0], {
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address],
    });
    if (json?.error) throw new Error(json.error.message);
    const lamports = Number(json?.result?.value ?? 0);
    return (lamports / 1e9).toString();
  }

  if (networkId === "sui") {
    const json = await postJson(NETWORKS.sui.rpcUrls[0], {
      jsonrpc: "2.0",
      id: 1,
      method: "suix_getBalance",
      params: [address],
    });
    if (json?.error) throw new Error(json.error.message);
    const total = BigInt(json?.result?.totalBalance ?? "0");
    return (Number(total) / 1e9).toString();
  }

  if (networkId === "aptos") {
    try {
      const json = await postJson(`${NETWORKS.aptos.rpcUrls[0]}/view`, {
        function: "0x1::coin::balance",
        type_arguments: ["0x1::aptos_coin::AptosCoin"],
        arguments: [address],
      });
      // The view endpoint answers with a JSON array, e.g. ["1000000000"] (octas).
      const octas = BigInt(Array.isArray(json) ? (json[0] ?? "0") : "0");
      return (Number(octas) / 1e8).toString();
    } catch (e) {
      console.error("Aptos balance fetch failed:", e);
      return "0.0";
    }
  }

  return withFallback(NETWORKS[networkId], async (url) => {
    const json = await postJson(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    if (json?.error) throw new Error(json.error.message);
    return formatEther(BigInt(json?.result ?? "0x0"));
  });
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export interface SendResult {
  hash: string;
  /** Resolves once the transaction is confirmed/finalised on its chain. */
  wait: () => Promise<{ gasUsed?: string } | null>;
}

/**
 * Send the native currency on `networkId`. Ported from the extension's
 * lib/rpc.ts, chain quirks and all — including the private-key formats each
 * chain's import path can produce, which is the part that actually bites:
 *
 *   Solana → base58 (the usual form) OR raw hex; 64 bytes = full secret key,
 *            32 bytes = a seed
 *   Sui    → a `suiprivkey...` bech32 string, base64, or hex
 *   Aptos  → hex, with or without the 0x
 *
 * Every SDK is imported LAZILY. They are large, and none of them is touched
 * until the moment someone actually sends — loading all three at startup would
 * put a chunk of parse time in front of the first frame for a screen most
 * sessions never reach.
 */
export async function sendNative(
  privateKey: string,
  to: string,
  amount: string,
  networkId: NetworkId = "monad"
): Promise<SendResult> {
  if (networkId === "solana") {
    const { Connection, PublicKey, Transaction, SystemProgram, Keypair } = await import(
      "@solana/web3.js"
    );
    const bs58 = (await import("bs58")).default;
    const connection = new Connection(NETWORKS.solana.rpcUrls[0], "confirmed");

    let decoded: Uint8Array;
    try {
      decoded = bs58.decode(privateKey.trim());
    } catch {
      const clean = privateKey.replace(/^0x/, "").trim();
      decoded = Uint8Array.from(Buffer.from(clean, "hex"));
    }
    const fromKeypair =
      decoded.length === 64 ? Keypair.fromSecretKey(decoded) : Keypair.fromSeed(decoded);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: new PublicKey(to.trim()),
        lamports: BigInt(Math.round(Number(amount) * 1e9)),
      })
    );

    const hash = await connection.sendTransaction(tx, [fromKeypair]);
    return {
      hash,
      wait: async () => {
        await connection.confirmTransaction(hash, "confirmed");
        return null;
      },
    };
  }

  if (networkId === "sui") {
    const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");
    const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
    const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
    const { fromBase64 } = await import("@mysten/sui/utils");
    const { Transaction } = await import("@mysten/sui/transactions");

    const client = new SuiJsonRpcClient({ url: NETWORKS.sui.rpcUrls[0], network: "testnet" });

    const trimmed = privateKey.trim();
    let keypair: InstanceType<typeof Ed25519Keypair>;
    if (trimmed.startsWith("suiprivkey")) {
      const { secretKey } = decodeSuiPrivateKey(trimmed);
      keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(trimmed);
      } catch {
        bytes = Uint8Array.from(Buffer.from(trimmed.replace(/^0x/, ""), "hex"));
      }
      keypair = Ed25519Keypair.fromSecretKey(bytes);
    }

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(Math.round(Number(amount) * 1e9))]);
    tx.transferObjects([coin], tx.pure.address(to.trim()));

    const res = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
    return {
      hash: res.digest,
      wait: async () => {
        await client.waitForTransaction({ digest: res.digest });
        return null;
      },
    };
  }

  if (networkId === "aptos") {
    const { Aptos, AptosConfig, Network: AptosNetwork, Account, Ed25519PrivateKey } = await import(
      "@aptos-labs/ts-sdk"
    );
    const aptos = new Aptos(new AptosConfig({ network: AptosNetwork.TESTNET }));
    const pk = new Ed25519PrivateKey(privateKey.trim().replace(/^0x/, ""));
    const sender = Account.fromPrivateKey({ privateKey: pk });

    const transaction = await aptos.transaction.build.simple({
      sender: sender.accountAddress,
      data: {
        function: "0x1::aptos_account::transfer",
        functionArguments: [to.trim(), Math.round(Number(amount) * 1e8)],
      },
    });
    const senderAuthenticator = aptos.transaction.sign({ signer: sender, transaction });
    const pending = await aptos.transaction.submit.simple({ transaction, senderAuthenticator });

    return {
      hash: pending.hash,
      wait: async () => {
        await aptos.transaction.waitForTransaction({ transactionHash: pending.hash });
        return null;
      },
    };
  }

  // EVM. This is the one place a real ethers provider earns its keep — signing
  // needs the nonce, the gas price and the chain id, and re-deriving all three
  // by hand would be three more round trips to get wrong.
  const net = NETWORKS[networkId];
  return withFallback(net, async (url) => {
    const ethNetwork = Network.from({ name: String(net.chainId), chainId: net.chainId });
    const provider = new JsonRpcProvider(url, ethNetwork, { staticNetwork: ethNetwork });
    const signer = new Wallet(privateKey, provider);
    const tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });
    return {
      hash: tx.hash,
      wait: async () => {
        const receipt = await tx.wait();
        return receipt ? { gasUsed: receipt.gasUsed.toString() } : null;
      },
    };
  });
}

/** Per-chain block-explorer transaction URL. */
export function explorerTxUrl(hash: string, networkId: NetworkId = "monad"): string {
  switch (networkId) {
    case "solana":
      return `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
    case "aptos":
      return `https://explorer.aptoslabs.com/txn/${hash}?network=testnet`;
    case "sui":
      return `https://suiscan.xyz/testnet/tx/${hash}`;
    default:
      return `${NETWORKS[networkId].explorerUrl}/tx/${hash}`;
  }
}

/** Per-chain block-explorer address URL (cluster/network live in the query). */
export function explorerAddrUrl(address: string, networkId: NetworkId = "monad"): string {
  switch (networkId) {
    case "solana":
      return `https://explorer.solana.com/address/${address}?cluster=devnet`;
    case "aptos":
      return `https://explorer.aptoslabs.com/account/${address}?network=testnet`;
    case "sui":
      return `https://suiscan.xyz/testnet/account/${address}`;
    default:
      return `${NETWORKS[networkId].explorerUrl}/address/${address}`;
  }
}
