/**
 * merkleTree.ts — the pool's commitment tree, rebuilt locally.
 *
 * Every spend from the pool (unhide, private send) has to prove that the note
 * it is spending is IN the tree, which means the wallet needs the same tree the
 * contract has and a Merkle path to its own leaf. The backend hands over the
 * ordered list of commitments; the tree is derived from that.
 *
 * WHY NOT @zk-kit/incremental-merkle-tree + circomlibjs, which is what the
 * extension uses: `buildPoseidon()` from circomlibjs compiles a WASM module,
 * and Hermes has no WebAssembly (see services/zkProver). `poseidon-lite` is
 * pure JS and produces the same field elements, so the tree is built on it
 * directly — a fixed-depth binary tree is about thirty lines and pulling in a
 * library to hold them would only re-introduce the hash problem.
 *
 * The shape must match the circuit exactly: depth 20, arity 2, zero leaf 0,
 * parent = poseidon2([left, right]).
 */

import { poseidon2 } from "poseidon-lite";

export const TREE_DEPTH = 20;

/** zeros[i] is the root of an empty subtree of height i. */
const ZEROS: bigint[] = (() => {
  const z: bigint[] = [0n];
  for (let i = 1; i <= TREE_DEPTH; i++) z.push(poseidon2([z[i - 1], z[i - 1]]));
  return z;
})();

export interface MerkleProof {
  /** the leaf itself */
  leaf: string;
  /** sibling at each level, bottom-up */
  siblings: string[];
  /** 0 = we are the LEFT child at that level, 1 = the right */
  pathIndices: number[];
  root: string;
}

/**
 * A fixed-depth tree that only ever grows on the right.
 *
 * Levels are stored densely — `levels[0]` is the leaves, `levels[d]` the root's
 * children — and only the nodes that actually exist are kept; everything to the
 * right of the frontier is an empty subtree, which is what ZEROS is for. That
 * keeps a depth-20 tree (a million leaves) the size of its contents rather than
 * the size of its capacity.
 */
export class PoolTree {
  private levels: bigint[][] = Array.from({ length: TREE_DEPTH + 1 }, () => []);

  get size(): number {
    return this.levels[0].length;
  }

  /** Append one commitment and repair the path above it. */
  insert(leaf: bigint): void {
    let index = this.levels[0].length;
    this.levels[0].push(leaf);

    for (let level = 0; level < TREE_DEPTH; level++) {
      const isRight = index % 2 === 1;
      const sibling = isRight
        ? this.levels[level][index - 1]
        : this.levels[level][index + 1] ?? ZEROS[level];
      const parent = isRight
        ? poseidon2([sibling, this.levels[level][index]])
        : poseidon2([this.levels[level][index], sibling]);

      index = Math.floor(index / 2);
      this.levels[level + 1][index] = parent;
    }
  }

  get root(): bigint {
    return this.levels[TREE_DEPTH][0] ?? ZEROS[TREE_DEPTH];
  }

  /** The path a circuit needs to re-derive the root from one leaf. */
  proof(leafIndex: number): MerkleProof | null {
    if (leafIndex < 0 || leafIndex >= this.levels[0].length) return null;

    const siblings: string[] = [];
    const pathIndices: number[] = [];
    let index = leafIndex;

    for (let level = 0; level < TREE_DEPTH; level++) {
      const isRight = index % 2 === 1;
      const sibling = isRight
        ? this.levels[level][index - 1]
        : this.levels[level][index + 1] ?? ZEROS[level];
      siblings.push((sibling ?? ZEROS[level]).toString());
      pathIndices.push(isRight ? 1 : 0);
      index = Math.floor(index / 2);
    }

    return {
      leaf: this.levels[0][leafIndex].toString(),
      siblings,
      pathIndices,
      root: this.root.toString(),
    };
  }
}

/** Re-derive a root from a proof — how you check one without the whole tree. */
export function rootFromProof(p: MerkleProof): string {
  let node = BigInt(p.leaf);
  for (let i = 0; i < p.siblings.length; i++) {
    const sib = BigInt(p.siblings[i]);
    node = p.pathIndices[i] === 1 ? poseidon2([sib, node]) : poseidon2([node, sib]);
  }
  return node.toString();
}
