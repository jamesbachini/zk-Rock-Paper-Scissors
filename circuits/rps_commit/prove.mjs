import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend, BarretenbergSync, Fr } from '@aztec/bb.js';

const here = dirname(fileURLToPath(import.meta.url));
const targetPath = resolve(here, 'target', 'rps_commit.json');

const circuit = JSON.parse(await readFile(targetPath, 'utf8'));
const args = process.argv.slice(2);
const move = args[0] ? Number(args[0]) : 1;
const salt = args[1] ? BigInt(args[1]) : 123456789n;
const sessionId = args[2] ? BigInt(args[2]) : 424242n;

if (!Number.isInteger(move) || move < 0 || move > 2) {
  throw new Error(`move must be 0, 1, or 2 (got ${args[0] ?? move})`);
}

const inputs = {
  move,
  salt: salt.toString(),
  session_id: sessionId.toString(),
};

const noir = new Noir(circuit);
await noir.init();
const { witness, returnValue } = await noir.execute(inputs);

const backend = new UltraHonkBackend(circuit.bytecode);
await backend.instantiate();
const proofData = await backend.generateProof(witness, { keccak: true });
const verified = await backend.verifyProof(proofData, { keccak: true });
await backend.destroy();

if (!verified) {
  throw new Error('Proof verification failed');
}

const outputs = Array.isArray(returnValue) ? returnValue : [returnValue];
if (outputs.length !== 2) {
  throw new Error(`Expected 2 public outputs, got ${outputs.length}`);
}

const toBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  if (typeof value === 'object' && value !== null && typeof value.toString === 'function') {
    const asString = value.toString();
    return BigInt(asString);
  }
  throw new Error(`Unsupported output type: ${typeof value}`);
};

const commitment = outputs[0];
const movePublic = outputs[1];
const movePublicBig = toBigInt(movePublic);

if (movePublicBig !== BigInt(move)) {
  throw new Error(`Public output ordering mismatch: expected move_public=${move}, got ${movePublicBig}`);
}

const api = await BarretenbergSync.new();
const inner = api.poseidon2Hash([new Fr(sessionId), new Fr(BigInt(move))]);
const expectedCommitment = api.poseidon2Hash([inner, new Fr(salt)]);
const expectedCommitmentBig = BigInt(expectedCommitment.toString());

if (toBigInt(commitment) !== expectedCommitmentBig) {
  throw new Error('Commitment does not match bb.js poseidon2 hash');
}

const publicInputs = proofData.publicInputs ?? [];
if (publicInputs.length >= 2) {
  const commitmentFromProof = BigInt(publicInputs[0]);
  const moveFromProof = BigInt(publicInputs[1]);
  if (commitmentFromProof !== toBigInt(commitment) || moveFromProof !== movePublicBig) {
    throw new Error('Proof publicInputs do not match circuit return values');
  }
}

console.log('Proof verified:', verified);
console.log('Public outputs [commitment, move_public]:');
console.log('  commitment:', commitment.toString());
console.log('  move_public:', movePublic.toString());
console.log('Expected commitment (bb.js):', expectedCommitment.toString());
console.log('Proof bytes length:', proofData.proof.length);
console.log('Proof publicInputs count:', publicInputs.length);
