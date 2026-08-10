/**
 * zk.ts — the deposit proof.
 *
 * The proving itself happens in services/zkProver, inside a real browser
 * engine; the long comment there explains why an in-process wasm runtime could
 * not work. What is left here is the shape the pool wants: eight field
 * elements, unpacked from snarkjs's printable calldata exactly as the
 * extension unpacks them.
 */

import { prove, type Circuit } from "./zkProver";

export interface Groth16Proof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[];
  /** the raw groth16 proof — some relayer routes take this rather than calldata */
  proof: unknown;
  /** How long the proof took, for the log. */
  ms: number;
}

/** Any of the three circuits — they all hand back the same eight elements. */
export async function proveCircuit(
  circuit: Circuit,
  input: Record<string, unknown>
): Promise<Groth16Proof> {
  const { calldata, proof, publicSignals, ms } = await prove(circuit, input);
  const argv = calldata.replace(/["[\]\s]/g, "").split(",");
  if (argv.length < 8) throw new Error("The prover returned malformed calldata.");
  return {
    a: [argv[0], argv[1]],
    b: [
      [argv[2], argv[3]],
      [argv[4], argv[5]],
    ],
    c: [argv[6], argv[7]],
    publicSignals,
    proof,
    ms,
  };
}

export const proveDeposit = (input: Record<string, string>) => proveCircuit("deposit", input);
