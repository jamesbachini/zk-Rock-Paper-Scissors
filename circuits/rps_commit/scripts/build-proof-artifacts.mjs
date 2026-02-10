import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const targetPath = resolve(root, 'target', 'rps_commit.json');
const artifactsDir = resolve(root, 'artifacts');

const circuit = JSON.parse(await readFile(targetPath, 'utf8'));

const move = 1;
const salt = 123456789n;
const inputs = {
  move,
  salt: salt.toString(),
};

const noir = new Noir(circuit);
await noir.init();
const { witness } = await noir.execute(inputs);

const backend = new UltraHonkBackend(circuit.bytecode);
await backend.instantiate();
const proofData = await backend.generateProof(witness);
const verified = await backend.verifyProof(proofData);
await backend.destroy();

if (!verified) {
  throw new Error('Proof verification failed');
}

const proofKeys = Object.keys(proofData);
console.log('Proof data keys:', proofKeys);
if (proofData.proof) {
  console.log('Proof bytes length:', proofData.proof.length);
}
if (proofData.proofFields) {
  console.log('Proof fields length:', proofData.proofFields.length);
}
if (proofData.publicInputs) {
  console.log('Public inputs length:', proofData.publicInputs.length);
}

const publicInputs = proofData.publicInputs ?? [];
if (publicInputs.length !== 2) {
  throw new Error(`Expected 2 public inputs, got ${publicInputs.length}`);
}

const encodeField = (value) => {
  if (value === null || value === undefined) {
    throw new Error('Public input is null/undefined');
  }
  const asString = typeof value === 'string' ? value : value.toString();
  const asBig = BigInt(asString);
  if (asBig < 0n) {
    throw new Error('Public input is negative');
  }
  let hex = asBig.toString(16);
  if (hex.length > 64) {
    throw new Error('Public input does not fit in 32 bytes');
  }
  hex = hex.padStart(64, '0');
  return Buffer.from(hex, 'hex');
};

const publicInputsBuf = Buffer.concat(publicInputs.map(encodeField));

await mkdir(artifactsDir, { recursive: true });
await writeFile(resolve(artifactsDir, 'public_inputs.bin'), publicInputsBuf);
await writeFile(resolve(artifactsDir, 'proof.bin'), Buffer.from(proofData.proof));

console.log('Wrote proof.bin and public_inputs.bin to', artifactsDir);
