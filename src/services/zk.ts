/**
 * zk.ts — making groth16 proofs possible on a phone.
 *
 * THE PROBLEM THIS FILE EXISTS FOR: Hermes has no WebAssembly. Not a partial
 * implementation — `typeof WebAssembly === "undefined"`. And snarkjs does not
 * prove in pure JS end to end: `groth16.fullProve` first runs the CIRCUIT's
 * witness calculator, which circom emits as a wasm module. So the whole path is
 * dead on arrival unless something can execute wasm.
 *
 * `react-native-webassembly` is that something — wasm3 compiled into the app
 * and reached over JSI. It exposes an `instantiate` that mirrors the browser
 * API closely enough that snarkjs never has to know: the shim below installs a
 * `globalThis.WebAssembly` in front of it, and snarkjs's witness calculator
 * picks it up as if it were running in a browser.
 *
 * ONE CONSEQUENCE WORTH KNOWING: wasm3 uses `musttail`, which ARM32 codegen
 * cannot satisfy (clang crashes outright), so the app is 64-bit only from here
 * on. See android/gradle.properties.
 *
 * The artifacts are bundled ASSETS rather than fetched, because a proving key
 * is the one thing that must not be swappable over the network: a substituted
 * zkey produces proofs that verify against a different circuit.
 */

import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { Buffer } from "buffer";

const DEPOSIT_WASM = require("../../assets/zk/deposit_proof.wasm");
const DEPOSIT_ZKEY = require("../../assets/zk/deposit_proof_final.zkey");

let shimmed = false;

/**
 * Put a browser-shaped `WebAssembly` in front of the JSI runtime.
 *
 * Only `instantiate` is needed: circom's witness calculator calls it once with
 * the module bytes and an import object, then talks to `instance.exports`.
 */
async function installWebAssemblyShim(): Promise<void> {
  if (shimmed || typeof (globalThis as any).WebAssembly !== "undefined") return;
  const rnwasm: any = await import("react-native-webassembly");

  /* ffjavascript reaches for SharedArrayBuffer to hand memory between threads.
     Single-threaded it never shares anything, but the SYMBOL still has to
     exist — `x instanceof SharedArrayBuffer` throws outright when it does not. */
  if (typeof (globalThis as any).SharedArrayBuffer === "undefined") {
    (globalThis as any).SharedArrayBuffer = ArrayBuffer;
  }

  /* The namespace needs its CONSTRUCTORS as well as instantiate: code guards
     with `instanceof WebAssembly.Module`, and `instanceof undefined` is not a
     false — it is a TypeError ("right operand of 'instanceof' is not an
     object") that takes the prover down. */
  class WasmModule {}
  class WasmInstance {}
  class WasmMemory {
    buffer: ArrayBuffer;
    constructor(d: any) {
      this.buffer = new ArrayBuffer((d?.initial ?? 1) * 65536);
    }
  }

  (globalThis as any).WebAssembly = {
    Module: WasmModule,
    Instance: WasmInstance,
    Memory: WasmMemory,
    Table: class {},
    Global: class {},
    CompileError: class extends Error {},
    RuntimeError: class extends Error {},
    LinkError: class extends Error {},
    async instantiate(source: BufferSource, importObject?: any) {
      const bytes =
        source instanceof Uint8Array
          ? source
          : new Uint8Array(source as ArrayBuffer);
      const mod = await rnwasm.instantiate(bytes, importObject ?? {});
      // The browser resolves to { module, instance }; wasm3's wrapper hands
      // back the same shape, but be tolerant of it returning the instance bare.
      return mod?.instance ? mod : { module: mod, instance: mod };
    },
    async compile(source: BufferSource) {
      return source;
    },
  };
  shimmed = true;
}

/** Read a bundled asset into memory. */
async function assetBytes(mod: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return new Uint8Array(Buffer.from(b64, "base64"));
}

let cached: { wasm: Uint8Array; zkey: Uint8Array } | null = null;

/** Both artifacts, read once and kept — 2.6 MB that should not be re-read. */
export async function depositArtifacts(): Promise<{ wasm: Uint8Array; zkey: Uint8Array }> {
  if (cached) return cached;
  const [wasm, zkey] = await Promise.all([
    assetBytes(DEPOSIT_WASM),
    assetBytes(DEPOSIT_ZKEY),
  ]);
  cached = { wasm, zkey };
  return cached;
}

export interface Groth16Proof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[];
}

/**
 * Prove the deposit circuit, and hand back the calldata the pool wants.
 *
 * snarkjs accepts the wasm and zkey as byte arrays, which is what lets both
 * live in the bundle instead of behind a URL.
 */
export async function proveDeposit(input: Record<string, string>): Promise<Groth16Proof> {
  await installWebAssemblyShim();
  /* ── Force the single-threaded prover ──
     ffjavascript decides how to parallelise AT IMPORT TIME: `if (globalThis
     ?.Blob) { new Blob([threadBytes]) }`, then spawns Workers off the resulting
     object URL. React Native HAS a Blob, but it cannot be built from an
     ArrayBuffer — so that line throws "Creating blobs from 'ArrayBuffer' ... are
     not supported" and takes the import down with it. Hiding Blob is not a
     hack, it is the truthful answer to the question being asked: there is no
     usable Blob here, so prove on this thread. */
  const hadBlob = (globalThis as any).Blob;
  try {
    delete (globalThis as any).Blob;
    var snarkjs: any = await import("snarkjs");
  } finally {
    if (hadBlob) (globalThis as any).Blob = hadBlob;
  }
  const { wasm, zkey } = await depositArtifacts();

  /* KNOWN LIMIT, as of 2026-08-10: this gets as far as ffjavascript building
     its bn128 curve — a wasm module IT generates at runtime — and that module
     comes back from wasm3 with no exports ("Cannot read property 'getVersion'
     of undefined"). The circuit's own witness wasm is not the problem; wasm3
     is an MVP-only interpreter and wasmcurves' module appears to need more.
     Everything upstream of this line is verified working on device. */
  let proof: any, publicSignals: any;
  try {
    ({ proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey));
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/getVersion|exports/.test(msg)) {
      throw new Error(
        "The on-device prover can't start: this wasm runtime doesn't support " +
          "ffjavascript's bn128 module. A native prover is needed."
      );
    }
    throw e;
  }

  /* exportSolidityCallData returns a printable blob; the pool wants the eight
     field elements. Same unpack the extension does. */
  const calldata: string = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const argv = calldata.replace(/["[\]\s]/g, "").split(",");
  return {
    a: [argv[0], argv[1]],
    b: [
      [argv[2], argv[3]],
      [argv[4], argv[5]],
    ],
    c: [argv[6], argv[7]],
    publicSignals,
  };
}
