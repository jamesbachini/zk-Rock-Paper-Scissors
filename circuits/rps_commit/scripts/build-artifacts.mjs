import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';
import { UltraHonkBackend } from '@aztec/bb.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const targetPath = resolve(root, 'target', 'rps_commit.json');
const artifactsDir = resolve(root, 'artifacts');

const circuitJson = JSON.parse(await readFile(targetPath, 'utf8'));
const acirCompressed = Buffer.from(circuitJson.bytecode, 'base64');
const acir = gunzipSync(acirCompressed);

await mkdir(artifactsDir, { recursive: true });
await writeFile(resolve(artifactsDir, 'circuit.json'), JSON.stringify(circuitJson, null, 2));
await writeFile(resolve(artifactsDir, 'acir.bin'), acir);

const backend = new UltraHonkBackend(circuitJson.bytecode);
await backend.instantiate();
const vk = await backend.getVerificationKey();
await backend.destroy();

const vkBuffer = Buffer.from(vk);
await writeFile(resolve(artifactsDir, 'vk.bin'), vkBuffer);
await writeFile(resolve(artifactsDir, 'vk.hex'), vkBuffer.toString('hex'));

console.log('Wrote artifacts to', artifactsDir);
