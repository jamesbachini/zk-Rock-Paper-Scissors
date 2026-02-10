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
const backend = new UltraHonkBackend(circuit.bytecode);
await backend.instantiate();

const noir = new Noir(circuit);
await noir.init();
const { witness } = await noir.execute({
  move: 1,
  salt: '123456789',
});

const options = { keccak: true };
const proofData = await backend.generateProof(witness, options);
const verified = await backend.verifyProof(proofData, options);
if (!verified) {
  throw new Error('Keccak proof verification failed');
}

const vk = await backend.getVerificationKey(options);
await backend.destroy();

const encodeField = (value) => {
  const asBig = BigInt(typeof value === 'string' ? value : value.toString());
  let hex = asBig.toString(16);
  hex = hex.padStart(64, '0');
  return Buffer.from(hex, 'hex');
};

const publicInputs = proofData.publicInputs ?? [];
if (publicInputs.length !== 2) {
  throw new Error(`Expected 2 public inputs, got ${publicInputs.length}`);
}

await mkdir(artifactsDir, { recursive: true });
await writeFile(resolve(artifactsDir, 'vk_keccak.bin'), Buffer.from(vk));
await writeFile(resolve(artifactsDir, 'proof_keccak.bin'), Buffer.from(proofData.proof));
await writeFile(
  resolve(artifactsDir, 'public_inputs_keccak.bin'),
  Buffer.concat(publicInputs.map(encodeField)),
);

console.log('Wrote vk_keccak.bin, proof_keccak.bin, public_inputs_keccak.bin');
