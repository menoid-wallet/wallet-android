/**
 * zkProver.tsx — groth16 proofs in a real browser engine.
 *
 * WHY THIS AND NOT A WASM SHIM. snarkjs delegates its arithmetic to
 * ffjavascript, which does this:
 *
 *     tm.memory   = new WebAssembly.Memory({ initial: MEM_SIZE });
 *     tm.instance = await WebAssembly.instantiate(mod, { env: { memory } });
 *
 * It IMPORTS the memory, then reads `memory.buffer` and calls `memory.grow()`
 * as the module runs. That is not something a shim can fake: the JS side and
 * the wasm side have to be looking at the same linear memory. wasm3 — the
 * interpreter behind react-native-webassembly — has no imported memory at all,
 * so the module came back with no exports and the first call died on
 * `getVersion`. No amount of shimming reaches past that.
 *
 * Android's WebView is a full Chromium. It has WebAssembly, imported memory,
 * growable memory, the lot — so snarkjs runs COMPLETELY UNMODIFIED inside it,
 * which is the point. No patched library, no reimplemented maths, nothing that
 * can drift away from what the extension proves with. The proof is the same
 * proof; only the engine differs.
 *
 * HOW IT IS WIRED. A single hidden WebView is mounted for the life of the app
 * (`ZkProverHost`, mounted in App). Callers use `prove()`, which resolves a
 * promise when the page posts the result back. The artifacts are copied out of
 * the bundle into the cache directory ONCE and the page fetches them from
 * alongside itself, rather than being marshalled across the bridge as several
 * megabytes of base64 on every proof.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

const SNARKJS = require("../../assets/zk/snarkjs.min.js");

/** The three circuits. Named, because the page is asked for one by name. */
export type Circuit = "deposit" | "withdraw" | "transfer";

const ARTIFACTS: Record<Circuit, { wasm: number; zkey: number }> = {
  deposit: {
    wasm: require("../../assets/zk/deposit_proof.wasm"),
    zkey: require("../../assets/zk/deposit_proof_final.zkey"),
  },
  withdraw: {
    wasm: require("../../assets/zk/withdraw_proof.wasm"),
    zkey: require("../../assets/zk/withdraw_proof_final.zkey"),
  },
  transfer: {
    wasm: require("../../assets/zk/transfer_proof.wasm"),
    zkey: require("../../assets/zk/transfer_proof_final.zkey"),
  },
};

/** The page. Deliberately tiny — everything heavy sits beside it on disk. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script src="./snarkjs.min.js"></script></head><body><script>
function reply(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }

/* XHR, not fetch. Android's WebView refuses fetch() across a file:// origin
   even with allowFileAccessFromFileURLs — it fails as an opaque "Failed to
   fetch" — while XHR with the same flags is permitted. */
function bytes(name){
  return new Promise(function(resolve, reject){
    try {
      const x = new XMLHttpRequest();
      x.open("GET", "./" + name, true);
      x.responseType = "arraybuffer";
      x.onload = function(){
        if (x.response) resolve(new Uint8Array(x.response));
        else reject(new Error("empty response for " + name));
      };
      x.onerror = function(){ reject(new Error("cannot read " + name)); };
      x.send();
    } catch (e) { reject(e); }
  });
}

/* Keyed by circuit and kept, because a zkey is up to 24 MB and re-reading it
   per batch would dominate a multi-batch send. */
var loaded = {};
async function load(circuit){
  if (!loaded[circuit]) {
    const [wasm, zkey] = await Promise.all([
      bytes(circuit + "_proof.wasm"),
      bytes(circuit + "_proof_final.zkey"),
    ]);
    loaded[circuit] = { wasm: wasm, zkey: zkey };
  }
  return loaded[circuit];
}

async function run(job){
  try {
    if (typeof snarkjs === "undefined") throw new Error("snarkjs did not load");
    const { wasm, zkey } = await load(job.circuit || "deposit");
    const t0 = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(job.input, wasm, zkey);
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    reply({ id: job.id, ok: true, calldata: calldata, proof: proof, publicSignals: publicSignals, ms: Date.now() - t0 });
  } catch (e) {
    reply({ id: job.id, ok: false, error: (e && e.message) ? e.message : String(e) });
  }
}

document.addEventListener("message", function(e){ run(JSON.parse(e.data)); });
window.addEventListener("message", function(e){ run(JSON.parse(e.data)); });
reply({ ready: true });
</script></body></html>`;

export interface ProveResult {
  calldata: string;
  /** the groth16 proof as snarkjs returns it — the transfer relay wants this */
  proof: unknown;
  publicSignals: string[];
  ms: number;
}

type Pending = {
  resolve: (v: ProveResult) => void;
  reject: (e: Error) => void;
};

const pending = new Map<number, Pending>();
let seq = 0;
let post: ((job: string) => void) | null = null;
let readyResolve: (() => void) | null = null;
const ready = new Promise<void>((r) => {
  readyResolve = r;
});

/**
 * Prove, from anywhere. Waits for the host to come up rather than failing if
 * something asks early.
 */
export async function prove(
  circuit: Circuit,
  input: Record<string, unknown>
): Promise<ProveResult> {
  await ready;
  if (!post) throw new Error("The prover is not running.");
  const id = ++seq;
  const p = new Promise<ProveResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  post(JSON.stringify({ id, circuit, input }));
  return p;
}

/** Copy the bundle's artifacts to a directory the page can fetch from. */
async function stage(): Promise<string> {
  const dir = `${FileSystem.cacheDirectory}zk/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const copies: [number, string][] = [
    [SNARKJS, "snarkjs.min.js"],
    ...(Object.keys(ARTIFACTS) as Circuit[]).flatMap(
      (c): [number, string][] => [
        [ARTIFACTS[c].wasm, `${c}_proof.wasm`],
        [ARTIFACTS[c].zkey, `${c}_proof_final.zkey`],
      ]
    ),
  ];
  for (const [mod, name] of copies) {
    const target = `${dir}${name}`;
    if ((await FileSystem.getInfoAsync(target)).exists) continue;
    const asset = Asset.fromModule(mod);
    await asset.downloadAsync();
    await FileSystem.copyAsync({ from: asset.localUri ?? asset.uri, to: target });
  }

  const html = `${dir}prover.html`;
  await FileSystem.writeAsStringAsync(html, PAGE);
  return html;
}

/**
 * Mount once, near the root. Renders nothing you can see — it is an engine, not
 * a screen.
 */
export function ZkProverHost() {
  const ref = useRef<WebView>(null);
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void stage()
      .then((u) => alive && setUri(u))
      .catch((e) => console.error("[zk] could not stage the prover:", e?.message ?? e));
    return () => {
      alive = false;
    };
  }, []);

  const onMessage = useCallback((e: any) => {
    let msg: any;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg?.ready) {
      post = (job: string) => ref.current?.postMessage(job);
      readyResolve?.();
      return;
    }
    const p = pending.get(msg?.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve({ calldata: msg.calldata, proof: msg.proof, publicSignals: msg.publicSignals, ms: msg.ms });
    else p.reject(new Error(msg.error || "Proof failed."));
  }, []);

  if (!uri) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ uri }}
        onMessage={onMessage}
        originWhitelist={["*"]}
        javaScriptEnabled
        /* The page fetches its own neighbours off disk. Without these three the
           file:// origin cannot read the files sitting next to it. */
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        domStorageEnabled
        androidLayerType="software"
        onError={(e) => console.error("[zk] webview error:", e.nativeEvent?.description)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /* Off screen rather than display:none — a WebView with no box does not always
     run its scripts. */
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, left: -9999, top: -9999 },
});
