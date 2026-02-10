import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BarretenbergSync, Fr } from '@aztec/bb.js';

const FR_BYTES = 32;
const PAIRING_POINTS_SIZE = 16;
const LOG_N = 28;
const BATCHED_RELATION_PARTIAL_LENGTH = 8;
const NUMBER_OF_ALPHAS = 25;
const NUMBER_OF_ENTITIES = 40;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const artifactsDir = resolve(root, 'artifacts');

const proofRaw = Buffer.from(await readFile(resolve(artifactsDir, 'proof.bin')));
const publicInputsRaw = Buffer.from(await readFile(resolve(artifactsDir, 'public_inputs.bin')));
const vkRaw = Buffer.from(await readFile(resolve(artifactsDir, 'vk.bin')));

if (publicInputsRaw.length % FR_BYTES !== 0) {
  throw new Error(`public_inputs.bin must be 32-byte aligned, got ${publicInputsRaw.length}`);
}

const toHex = (buf) => buf.toString('hex');

function readU64BE(buf, offset) {
  return Number(buf.readBigUInt64BE(offset));
}

function u64ToBe32(value) {
  const out = Buffer.alloc(FR_BYTES);
  out.writeBigUInt64BE(BigInt(value), 24);
  return out;
}

function splitChallenge(challenge) {
  const challengeBytes = Buffer.from(challenge.toBuffer());
  const low = Buffer.alloc(FR_BYTES);
  low.set(challengeBytes.subarray(16, 32), 16);
  const high = Buffer.alloc(FR_BYTES);
  high.set(challengeBytes.subarray(0, 16), 16);
  return { low, high };
}

function coordToHalvesBE(coord) {
  const low = Buffer.alloc(FR_BYTES);
  const high = Buffer.alloc(FR_BYTES);
  low.set(coord.subarray(15, 32), 15);
  high.set(coord.subarray(0, 15), 17);
  return [low, high];
}

function combineLimbs(low, high) {
  const out = Buffer.alloc(FR_BYTES);
  out.set(high.subarray(17, 32), 0);
  out.set(low.subarray(15, 32), 15);
  return out;
}

function pushPoint(fields, point) {
  const [xLo, xHi] = coordToHalvesBE(point.x);
  const [yLo, yHi] = coordToHalvesBE(point.y);
  fields.push(xLo, xHi, yLo, yHi);
}

function chunkToFields(buf) {
  if (buf.length % FR_BYTES !== 0) {
    throw new Error(`expected 32-byte aligned payload, got ${buf.length} bytes`);
  }
  const out = [];
  for (let i = 0; i < buf.length; i += FR_BYTES) {
    out.push(buf.subarray(i, i + FR_BYTES));
  }
  return out;
}

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.offset = 0;
  }

  read32() {
    const next = this.buf.subarray(this.offset, this.offset + FR_BYTES);
    this.offset += FR_BYTES;
    return next;
  }
}

function parseProof(proof) {
  if (proof.length % FR_BYTES !== 0) {
    throw new Error(`proof.bin is not 32-byte aligned: ${proof.length}`);
  }

  const rd = new Reader(proof);
  const readPoint = () => {
    const xLo = rd.read32();
    const xHi = rd.read32();
    const yLo = rd.read32();
    const yHi = rd.read32();
    return {
      x: combineLimbs(xLo, xHi),
      y: combineLimbs(yLo, yHi),
    };
  };

  const proofData = {
    pairingPointObject: Array.from({ length: PAIRING_POINTS_SIZE }, () => rd.read32()),
    w1: readPoint(),
    w2: readPoint(),
    w3: readPoint(),
    lookupReadCounts: readPoint(),
    lookupReadTags: readPoint(),
    w4: readPoint(),
    lookupInverses: readPoint(),
    zPerm: readPoint(),
    sumcheckUnivariates: Array.from({ length: LOG_N }, () =>
      Array.from({ length: BATCHED_RELATION_PARTIAL_LENGTH }, () => rd.read32()),
    ),
    sumcheckEvaluations: Array.from({ length: NUMBER_OF_ENTITIES }, () => rd.read32()),
    geminiFoldComms: Array.from({ length: LOG_N - 1 }, () => readPoint()),
    geminiAEvaluations: Array.from({ length: LOG_N }, () => rd.read32()),
    shplonkQ: readPoint(),
    kzgQuotient: readPoint(),
  };

  if (rd.offset !== proof.length) {
    throw new Error(`proof parser consumed ${rd.offset}, expected ${proof.length}`);
  }

  return proofData;
}

const bb = await BarretenbergSync.new();
const proof = parseProof(proofRaw);
const publicInputs = chunkToFields(publicInputsRaw);

const circuitSize = readU64BE(vkRaw, 0);
const publicInputsSize = publicInputs.length + PAIRING_POINTS_SIZE;
const pubInputsOffset = 1;

const steps = [];
let previousChallenge = null;

function recordStep(name, fields) {
  const inputFields = fields.map((f) => Buffer.from(f));
  const digestFr = bb.poseidon2Hash(inputFields.map((f) => new Fr(f)));
  const digest = Buffer.from(digestFr.toBuffer());
  const { low, high } = splitChallenge(digestFr);
  steps.push({ name, digest, low, high, inputFields });
  previousChallenge = digest;
}

{
  const fields = [
    u64ToBe32(circuitSize),
    u64ToBe32(publicInputsSize),
    u64ToBe32(pubInputsOffset),
    ...publicInputs,
    ...proof.pairingPointObject,
  ];
  pushPoint(fields, proof.w1);
  pushPoint(fields, proof.w2);
  pushPoint(fields, proof.w3);
  recordStep('eta_round_0', fields);
}

recordStep('eta_round_1', [previousChallenge]);

{
  const fields = [previousChallenge];
  pushPoint(fields, proof.lookupReadCounts);
  pushPoint(fields, proof.lookupReadTags);
  pushPoint(fields, proof.w4);
  recordStep('beta_gamma_round_0', fields);
}

{
  const fields = [previousChallenge];
  pushPoint(fields, proof.lookupInverses);
  pushPoint(fields, proof.zPerm);
  recordStep('alpha_round_0', fields);
}

const alphaPairs = Math.floor(NUMBER_OF_ALPHAS / 2);
for (let i = 1; i < alphaPairs; i++) {
  recordStep(`alpha_round_${i}`, [previousChallenge]);
}

if ((NUMBER_OF_ALPHAS & 1) === 1 && NUMBER_OF_ALPHAS > 2) {
  recordStep('alpha_round_last', [previousChallenge]);
}

for (let i = 0; i < LOG_N; i++) {
  recordStep(`gate_round_${i}`, [previousChallenge]);
}

for (let i = 0; i < LOG_N; i++) {
  const fields = [previousChallenge, ...proof.sumcheckUnivariates[i]];
  recordStep(`sumcheck_round_${i}`, fields);
}

recordStep('rho_round_0', [previousChallenge, ...proof.sumcheckEvaluations]);

{
  const fields = [previousChallenge];
  for (const point of proof.geminiFoldComms) {
    pushPoint(fields, point);
  }
  recordStep('gemini_r_round_0', fields);
}

recordStep('shplonk_nu_round_0', [previousChallenge, ...proof.geminiAEvaluations]);

{
  const fields = [previousChallenge];
  pushPoint(fields, proof.shplonkQ);
  recordStep('shplonk_z_round_0', fields);
}

const outLines = [];
outLines.push('# Poseidon2 UltraHonk transcript parity fixture (bb.js)');
outLines.push('# format: name|digest_hex|challenge_lo_hex|challenge_hi_hex|input_fields_hex_csv');
for (const step of steps) {
  const inputCsv = step.inputFields.map(toHex).join(',');
  outLines.push(
    `${step.name}|${toHex(step.digest)}|${toHex(step.low)}|${toHex(step.high)}|${inputCsv}`,
  );
}

const outPath = resolve(artifactsDir, 'transcript_poseidon2_trace.txt');
await writeFile(outPath, `${outLines.join('\n')}\n`);

console.log(`Wrote ${steps.length} transcript trace steps to ${outPath}`);
