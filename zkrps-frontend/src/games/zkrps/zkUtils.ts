import { UltraHonkBackend, BarretenbergSync, Fr } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { Buffer } from 'buffer';
import circuit from './circuit.json';

if (typeof window !== 'undefined') {
  // @ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

const FIELD_BYTES = 32;

let noirPromise: Promise<Noir> | null = null;
let bbPromise: Promise<BarretenbergSync> | null = null;

function getNoir(): Promise<Noir> {
  if (!noirPromise) {
    const noir = new Noir(circuit as any);
    noirPromise = noir.init().then(() => noir);
  }
  return noirPromise;
}

function getBarretenberg(): Promise<BarretenbergSync> {
  if (!bbPromise) {
    bbPromise = BarretenbergSync.new();
  }
  return bbPromise;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  throw new Error(`Unsupported field value type: ${typeof value}`);
}

export function generateSalt(): bigint {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(31);
    crypto.getRandomValues(bytes);
    return BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  }

  const fallback = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  return BigInt(fallback);
}

export function toHex(value: bigint, bytes: number = FIELD_BYTES): string {
  const hex = value.toString(16).padStart(bytes * 2, '0');
  return `0x${hex}`;
}

export function bigIntToBytes32(value: bigint): Buffer {
  const hex = value.toString(16);
  if (hex.length > FIELD_BYTES * 2) {
    throw new Error('Field element does not fit in 32 bytes');
  }
  return Buffer.from(hex.padStart(FIELD_BYTES * 2, '0'), 'hex');
}

export async function computeCommitment(
  sessionId: number,
  move: number,
  salt: bigint
): Promise<bigint> {
  const bb = await getBarretenberg();
  const inner = bb.poseidon2Hash([new Fr(BigInt(sessionId)), new Fr(BigInt(move))]);
  const commitment = bb.poseidon2Hash([inner, new Fr(salt)]);
  return BigInt(commitment.toString());
}

export async function generateProof(
  inputs: {
    sessionId: number;
    move: number;
    salt: bigint;
  },
  onProgress?: (stage: string) => void
): Promise<{
  proof: Buffer;
  publicInputs: Buffer;
  commitment: bigint;
  movePublic: bigint;
}> {
  onProgress?.('Initializing Noir runtime...');
  const noir = await getNoir();
  onProgress?.('Generating witness...');
  const { witness, returnValue } = await noir.execute({
    move: inputs.move,
    salt: inputs.salt.toString(),
    session_id: inputs.sessionId.toString(),
  });

  const backend = new UltraHonkBackend((circuit as any).bytecode);
  onProgress?.('Initializing UltraHonk backend...');
  await backend.instantiate();

  try {
    onProgress?.('Downloading CRS / generating proof (first run can take a while)...');
    const proofData = await backend.generateProof(witness, { keccak: true });

    const outputs = Array.isArray(returnValue) ? returnValue : [returnValue];
    if (outputs.length !== 2) {
      throw new Error(`Expected 2 public outputs, got ${outputs.length}`);
    }

    const commitment = toBigInt(outputs[0]);
    const movePublic = toBigInt(outputs[1]);

    if (movePublic !== BigInt(inputs.move)) {
      throw new Error(`Public move mismatch: expected ${inputs.move}, got ${movePublic}`);
    }

    onProgress?.('Validating commitment...');
    const expectedCommitment = await computeCommitment(inputs.sessionId, inputs.move, inputs.salt);
    if (commitment !== expectedCommitment) {
      throw new Error('Commitment does not match Poseidon2 hash');
    }

    const proofInputs = proofData.publicInputs && proofData.publicInputs.length >= 2
      ? proofData.publicInputs
      : [commitment, movePublic];

    const publicInputBytes = Buffer.concat([
      bigIntToBytes32(toBigInt(proofInputs[0])),
      bigIntToBytes32(toBigInt(proofInputs[1])),
    ]);

    return {
      proof: Buffer.from(proofData.proof),
      publicInputs: publicInputBytes,
      commitment,
      movePublic,
    };
  } finally {
    await backend.destroy();
  }
}
