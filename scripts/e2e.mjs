#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { randomBytes } from 'crypto';
import {
  rpc,
  Keypair,
  TransactionBuilder,
  hash,
} from '@stellar/stellar-sdk';
import { Client as ContractClient } from '@stellar/stellar-sdk/contract';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CIRCUIT_DIR = resolve(ROOT, 'circuits', 'rps_commit');
const CIRCUIT_TARGET = resolve(CIRCUIT_DIR, 'target', 'rps_commit.json');
const VK_PATH = resolve(CIRCUIT_DIR, 'artifacts', 'vk.bin');
const RPS_WASM = resolve(ROOT, 'target', 'wasm32v1-none', 'release', 'rps_game.wasm');
const VERIFIER_WASM = resolve(ROOT, 'target', 'wasm32v1-none', 'release', 'ultrahonk_soroban_contract.wasm');

const args = new Set(process.argv.slice(2));
const FORCE_DEPLOY = args.has('--deploy');
const SKIP_BUILD = args.has('--skip-build');

function logStep(message) {
  console.log(`\n=== ${message} ===`);
}

function run(cmd, { capture = false } = {}) {
  if (capture) {
    return execSync(`${cmd} 2>&1`, { cwd: ROOT, encoding: 'utf8', shell: true });
  }
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  return '';
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const text = execSync(`cat ${path}`, { encoding: 'utf8' });
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(execSync(`cat ${path}`, { encoding: 'utf8' }));
}

function extractContractId(output) {
  const match = output.match(/C[A-Z2-7]{55}/);
  if (!match) {
    throw new Error(`Failed to parse contract ID from output:\n${output}`);
  }
  return match[0];
}

function makeSigner(keypair) {
  const publicKey = keypair.publicKey();
  return {
    publicKey,
    signTransaction: async (txXdr, opts) => {
      const tx = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
      tx.sign(keypair);
      return { signedTxXdr: tx.toXDR(), signerAddress: publicKey };
    },
    signAuthEntry: async (preimageXdr) => {
      const preimageBytes = Buffer.from(preimageXdr, 'base64');
      const payload = hash(preimageBytes);
      const signatureBytes = keypair.sign(payload);
      return {
        signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
        signerAddress: publicKey,
      };
    },
  };
}

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return BigInt(value.toString());
  }
  throw new Error(`Unsupported field value type: ${typeof value}`);
}

function bigIntToBytes32(value) {
  const hex = value.toString(16);
  if (hex.length > 64) {
    throw new Error('Field element does not fit in 32 bytes');
  }
  return Buffer.from(hex.padStart(64, '0'), 'hex');
}

function buffersEqual(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.equals(bufB);
}

async function signAndSendWithBudgetHint(tx, label) {
  try {
    await tx.signAndSend();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Budget') && msg.includes('ExceededLimit')) {
      throw new Error(
        `${label} failed: Budget/ExceededLimit. Ultrahonk verification can exceed testnet limits. ` +
          'Run against a local Soroban network with higher limits.'
      );
    }
    throw err;
  }
}

async function ensureCircuitArtifacts() {
  if (!existsSync(CIRCUIT_DIR)) {
    throw new Error(`Missing circuit directory: ${CIRCUIT_DIR}`);
  }

  if (!existsSync(resolve(CIRCUIT_DIR, 'node_modules'))) {
    logStep('Installing circuit dependencies');
    execSync('bun install', { cwd: CIRCUIT_DIR, stdio: 'inherit' });
  }

  const needsCompile = !existsSync(CIRCUIT_TARGET);
  const needsArtifacts = !existsSync(VK_PATH);

  if (needsCompile) {
    logStep('Compiling Noir circuit');
    execSync('bun run compile', { cwd: CIRCUIT_DIR, stdio: 'inherit' });
  }

  if (needsArtifacts) {
    logStep('Building circuit artifacts');
    execSync('bun run artifacts', { cwd: CIRCUIT_DIR, stdio: 'inherit' });
  }
}

async function loadCircuitDeps() {
  const require = createRequire(import.meta.url);
  const noirPath = require.resolve('@noir-lang/noir_js', { paths: [CIRCUIT_DIR] });
  const bbPath = require.resolve('@aztec/bb.js', { paths: [CIRCUIT_DIR] });

  const noirModule = await import(noirPath);
  const bbModule = await import(bbPath);

  return {
    Noir: noirModule.Noir,
    UltraHonkBackend: bbModule.UltraHonkBackend,
    BarretenbergSync: bbModule.BarretenbergSync,
    Fr: bbModule.Fr,
  };
}

async function ensureBuilds() {
  if (SKIP_BUILD) return;
  if (!existsSync(RPS_WASM)) {
    logStep('Building rps_game contract');
    run('stellar contract build --manifest-path contracts/rps_game/Cargo.toml');
  }
  if (!existsSync(VERIFIER_WASM)) {
    logStep('Building verifier contract');
    run('stellar contract build --manifest-path contracts/verifier/Cargo.toml');
  }
}

async function contractExists(server, contractId) {
  try {
    await server.getContractWasmByContractId(contractId);
    return true;
  } catch {
    return false;
  }
}

async function ensureFunded(address, horizonUrl, friendbotUrl) {
  const res = await fetch(`${horizonUrl}/accounts/${address}`);
  if (res.ok) return;
  if (res.status !== 404) {
    throw new Error(`Horizon error ${res.status} for ${address}`);
  }

  if (!friendbotUrl) {
    throw new Error(`Missing friendbot URL for funding ${address}`);
  }

  const fund = await fetch(`${friendbotUrl}?addr=${address}`);
  if (!fund.ok) {
    throw new Error(`Friendbot funding failed (${fund.status}) for ${address}`);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((r) => setTimeout(r, 750));
    const check = await fetch(`${horizonUrl}/accounts/${address}`);
    if (check.ok) return;
  }

  throw new Error(`Funded ${address} but Horizon did not show it in time`);
}

async function signAuthEntriesFor(tx, signerMap, server, expirationOverride) {
  const expiration = expirationOverride ?? (await server.getLatestLedger()).sequence + 200;
  const needed = tx.needsNonInvokerSigningBy();
  for (const address of needed) {
    const signer = signerMap.get(address);
    if (!signer) {
      throw new Error(`Missing signer for auth entry: ${address}`);
    }
    await tx.signAuthEntries({
      address,
      expiration,
      signAuthEntry: signer.signAuthEntry,
    });
  }
}

async function main() {
  const env = parseEnvFile(resolve(ROOT, '.env'));
  const deployment = readJsonIfExists(resolve(ROOT, 'deployment.json')) ?? {};

  if (!existsSync(resolve(ROOT, 'node_modules', '@stellar', 'stellar-sdk'))) {
    logStep('Installing root dependencies');
    run('bun install');
  }

  const requestedNetwork = process.env.E2E_NETWORK || '';

  let rpcUrl =
    process.env.E2E_RPC_URL ||
    env.VITE_SOROBAN_RPC_URL ||
    deployment.rpcUrl ||
    'https://soroban-testnet.stellar.org';

  if (requestedNetwork === 'local' && !process.env.E2E_RPC_URL) {
    rpcUrl = 'http://localhost:8000/soroban/rpc';
  }

  let networkPassphrase =
    process.env.E2E_NETWORK_PASSPHRASE ||
    env.VITE_NETWORK_PASSPHRASE ||
    deployment.networkPassphrase ||
    '';

  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(rpcUrl);
  const isTestnet = rpcUrl.includes('testnet');
  const networkName =
    requestedNetwork || (isTestnet ? 'testnet' : isLocal ? 'local' : 'mainnet');

  if (!networkPassphrase && isTestnet) {
    networkPassphrase = 'Test SDF Network ; September 2015';
  }

  if (!networkPassphrase && networkName === 'local') {
    try {
      const info = run('stellar network info -n local --output json', { capture: true });
      const parsed = JSON.parse(info);
      if (parsed?.passphrase) {
        networkPassphrase = parsed.passphrase;
      }
    } catch {
      // Leave as-is; we'll error below with a clearer message.
    }
  }

  if (!networkPassphrase) {
    throw new Error('Missing network passphrase (set E2E_NETWORK_PASSPHRASE or VITE_NETWORK_PASSPHRASE).');
  }

  const horizonUrl =
    process.env.E2E_HORIZON_URL ||
    (isLocal ? 'http://localhost:8000' : isTestnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');

  const friendbotUrl =
    process.env.E2E_FRIENDBOT_URL ||
    (isLocal ? 'http://localhost:8000/friendbot' : isTestnet ? 'https://friendbot.stellar.org' : '');

  const gameHubId =
    process.env.E2E_GAME_HUB_CONTRACT_ID ||
    env.VITE_MOCK_GAME_HUB_CONTRACT_ID ||
    deployment?.contracts?.['mock-game-hub'] ||
    deployment?.mockGameHubId ||
    '';

  if (!gameHubId) {
    throw new Error('Missing GameHub contract ID (set E2E_GAME_HUB_CONTRACT_ID or VITE_MOCK_GAME_HUB_CONTRACT_ID).');
  }

  let rpsContractId =
    process.env.E2E_RPS_CONTRACT_ID ||
    env.VITE_RPS_GAME_CONTRACT_ID ||
    deployment?.contracts?.['rps_game'] ||
    deployment?.contracts?.['rps-game'] ||
    '';

  let verifierContractId =
    process.env.E2E_VERIFIER_CONTRACT_ID ||
    env.VITE_ULTRAHONK_SOROBAN_CONTRACT_CONTRACT_ID ||
    deployment?.contracts?.['ultrahonk_soroban_contract'] ||
    '';

  const adminSecret = process.env.E2E_ADMIN_SECRET || env.VITE_DEV_ADMIN_SECRET || '';
  const player1Secret = process.env.E2E_PLAYER1_SECRET || env.VITE_DEV_PLAYER1_SECRET || '';
  const player2Secret = process.env.E2E_PLAYER2_SECRET || env.VITE_DEV_PLAYER2_SECRET || '';

  const adminKeypair = adminSecret ? Keypair.fromSecret(adminSecret) : Keypair.random();
  const player1Keypair = player1Secret ? Keypair.fromSecret(player1Secret) : Keypair.random();
  const player2Keypair = player2Secret ? Keypair.fromSecret(player2Secret) : Keypair.random();

  const adminSigner = makeSigner(adminKeypair);
  const player1Signer = makeSigner(player1Keypair);
  const player2Signer = makeSigner(player2Keypair);

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const cpuLeeway = Number(
    process.env.E2E_CPU_LEEWAY || env.E2E_CPU_LEEWAY || '0'
  );
  if (cpuLeeway > 0) {
    const originalSimulate = server.simulateTransaction.bind(server);
    server.simulateTransaction = (tx, addlResources, authMode) => {
      const extra = addlResources?.cpuInstructions ?? 0;
      return originalSimulate(tx, { cpuInstructions: extra + cpuLeeway }, authMode);
    };
    console.log(`ℹ️  Using simulation CPU leeway: ${cpuLeeway.toLocaleString()}`);
  }

  if (friendbotUrl) {
    logStep('Ensuring accounts are funded');
    await ensureFunded(adminSigner.publicKey, horizonUrl, friendbotUrl);
    await ensureFunded(player1Signer.publicKey, horizonUrl, friendbotUrl);
    await ensureFunded(player2Signer.publicKey, horizonUrl, friendbotUrl);
  }

  await ensureCircuitArtifacts();
  await ensureBuilds();
  if (isTestnet) {
    console.log('⚠️  Testnet budget limits may reject Ultrahonk verification. Use a local Soroban network if reveals fail with Budget/ExceededLimit.');
  }

  if (FORCE_DEPLOY || !verifierContractId || !(await contractExists(server, verifierContractId))) {
    logStep('Deploying verifier contract');
    const deployOutput = run(
      `stellar contract deploy --wasm ${VERIFIER_WASM} --source ${adminKeypair.secret()} --rpc-url ${rpcUrl} --network-passphrase "${networkPassphrase}" --network ${networkName} -- --vk_bytes-file-path ${VK_PATH}`,
      { capture: true }
    );
    console.log(deployOutput.trim());
    verifierContractId = extractContractId(deployOutput);
  }

  if (FORCE_DEPLOY || !rpsContractId || !(await contractExists(server, rpsContractId))) {
    logStep('Deploying rps_game contract');
    const deployOutput = run(
      `stellar contract deploy --wasm ${RPS_WASM} --source ${adminKeypair.secret()} --rpc-url ${rpcUrl} --network-passphrase "${networkPassphrase}" --network ${networkName}`,
      { capture: true }
    );
    console.log(deployOutput.trim());
    rpsContractId = extractContractId(deployOutput);
  }

  const rpsWasm = await readFile(RPS_WASM);

  const adminClient = await ContractClient.fromWasm(rpsWasm, {
    contractId: rpsContractId,
    rpcUrl,
    networkPassphrase,
    publicKey: adminSigner.publicKey,
    signTransaction: adminSigner.signTransaction,
    signAuthEntry: adminSigner.signAuthEntry,
    server,
  });

  logStep('Ensuring contract initialized');
  const initTx = await adminClient.init({
    game_hub: gameHubId,
    verifier: verifierContractId,
    commit_window: 100,
    reveal_window: 100,
  });
  try {
    await initTx.signAndSend();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('AlreadyInitialized') && !msg.includes('Error(Contract, #1)')) {
      throw err;
    }
  }

  const player1Client = await ContractClient.fromWasm(rpsWasm, {
    contractId: rpsContractId,
    rpcUrl,
    networkPassphrase,
    publicKey: player1Signer.publicKey,
    signTransaction: player1Signer.signTransaction,
    signAuthEntry: player1Signer.signAuthEntry,
    server,
  });

  const player2Client = await ContractClient.fromWasm(rpsWasm, {
    contractId: rpsContractId,
    rpcUrl,
    networkPassphrase,
    publicKey: player2Signer.publicKey,
    signTransaction: player2Signer.signTransaction,
    signAuthEntry: player2Signer.signAuthEntry,
    server,
  });

  const { Noir, UltraHonkBackend, BarretenbergSync, Fr } = await loadCircuitDeps();
  const circuitJson = JSON.parse(await readFile(CIRCUIT_TARGET, 'utf8'));

  let sessionId = Number(BigInt(`0x${randomBytes(4).toString('hex')}`));
  if (sessionId === 0) sessionId = 1;
  const move1 = 0; // Rock
  const move2 = 2; // Scissors
  const salt1 = BigInt(`0x${randomBytes(31).toString('hex')}`);
  const salt2 = BigInt(`0x${randomBytes(31).toString('hex')}`);

  logStep('Creating session');
  const createTx = await player2Client.create_session({
    session_id: sessionId,
    player1: player1Signer.publicKey,
    player2: player2Signer.publicKey,
  });
  const signerMap = new Map([
    [player1Signer.publicKey, player1Signer],
    [player2Signer.publicKey, player2Signer],
  ]);
  await signAuthEntriesFor(createTx, signerMap, server);
  await createTx.signAndSend();

  const bb = await BarretenbergSync.new();
  const computeCommitment = (session, move, salt) => {
    const inner = bb.poseidon2Hash([new Fr(BigInt(session)), new Fr(BigInt(move))]);
    const commitment = bb.poseidon2Hash([inner, new Fr(salt)]);
    return BigInt(commitment.toString());
  };

  const commitment1 = computeCommitment(sessionId, move1, salt1);
  const commitment2 = computeCommitment(sessionId, move2, salt2);

  const commit1Tx = await player1Client.commit_move({
    session_id: sessionId,
    player: player1Signer.publicKey,
    commitment: bigIntToBytes32(commitment1),
  });
  await signAuthEntriesFor(commit1Tx, signerMap, server);
  await commit1Tx.signAndSend();

  const commit2Tx = await player2Client.commit_move({
    session_id: sessionId,
    player: player2Signer.publicKey,
    commitment: bigIntToBytes32(commitment2),
  });
  await signAuthEntriesFor(commit2Tx, signerMap, server);
  await commit2Tx.signAndSend();

  const commitmentCheckTx = await player1Client.get_commitment({
    session_id: sessionId,
    player: player1Signer.publicKey,
  });
  await commitmentCheckTx.simulate();
  const commitmentCheck = commitmentCheckTx.result;
  if (!commitmentCheck.isOk || !commitmentCheck.isOk()) {
    throw new Error('Failed to read commitment via get_commitment');
  }
  const onchainCommitment = commitmentCheck.unwrap();
  if (!buffersEqual(onchainCommitment, bigIntToBytes32(commitment1))) {
    throw new Error('On-chain commitment does not match expected commitment');
  }

  async function generateProof(move, salt) {
    const noir = new Noir(circuitJson);
    await noir.init();
    const { witness, returnValue } = await noir.execute({
      move,
      salt: salt.toString(),
      session_id: sessionId.toString(),
    });

    const backend = new UltraHonkBackend(circuitJson.bytecode);
    await backend.instantiate();
    const proofData = await backend.generateProof(witness, { keccak: true });
    await backend.destroy();

    const outputs = Array.isArray(returnValue) ? returnValue : [returnValue];
    if (outputs.length !== 2) {
      throw new Error(`Expected 2 public outputs, got ${outputs.length}`);
    }

    const commitment = toBigInt(outputs[0]);
    const movePublic = toBigInt(outputs[1]);

    return {
      proof: Buffer.from(proofData.proof),
      publicInputs: Buffer.concat([
        bigIntToBytes32(commitment),
        bigIntToBytes32(movePublic),
      ]),
      commitment,
      movePublic,
    };
  }

  logStep('Generating proofs');
  const proof1 = await generateProof(move1, salt1);
  const proof2 = await generateProof(move2, salt2);

  if (proof1.commitment !== commitment1) {
    throw new Error('Commitment mismatch for player1');
  }
  if (proof2.commitment !== commitment2) {
    throw new Error('Commitment mismatch for player2');
  }

  logStep('Revealing moves');
  const reveal1Tx = await player1Client.reveal_move({
    session_id: sessionId,
    player: player1Signer.publicKey,
    proof: proof1.proof,
    public_inputs: proof1.publicInputs,
  });
  await signAuthEntriesFor(reveal1Tx, signerMap, server);
  await signAndSendWithBudgetHint(reveal1Tx, 'Reveal (player1)');

  const reveal2Tx = await player2Client.reveal_move({
    session_id: sessionId,
    player: player2Signer.publicKey,
    proof: proof2.proof,
    public_inputs: proof2.publicInputs,
  });
  await signAuthEntriesFor(reveal2Tx, signerMap, server);
  await signAndSendWithBudgetHint(reveal2Tx, 'Reveal (player2)');

  const moveCheckTx = await player2Client.get_move({
    session_id: sessionId,
    player: player2Signer.publicKey,
  });
  await moveCheckTx.simulate();
  const moveCheck = moveCheckTx.result;
  if (!moveCheck.isOk || !moveCheck.isOk()) {
    throw new Error('Failed to read move via get_move');
  }
  if (moveCheck.unwrap() !== move2) {
    throw new Error('On-chain move does not match expected move');
  }

  logStep('Finalizing session');
  const finalizeTx = await player1Client.finalize({ session_id: sessionId });
  await finalizeTx.signAndSend();

  logStep('Asserting winner');
  const sessionTx = await player1Client.get_session({ session_id: sessionId });
  await sessionTx.simulate();
  const sessionResult = sessionTx.result;
  if (!sessionResult.isOk || !sessionResult.isOk()) {
    throw new Error('Failed to fetch session data');
  }

  const session = sessionResult.unwrap();
  const expectedWinner = 1; // Player 1 should win with Rock vs Scissors

  if (session.winner !== expectedWinner) {
    throw new Error(`Unexpected winner: ${session.winner} (expected ${expectedWinner})`);
  }

  console.log('\n✅ E2E completed successfully');
  console.log(`Session ID: ${sessionId}`);
  console.log(`RPS Contract ID: ${rpsContractId}`);
  console.log(`Verifier Contract ID: ${verifierContractId}`);
  console.log(`Player1: ${player1Signer.publicKey}`);
  console.log(`Player2: ${player2Signer.publicKey}`);

  if (!player1Secret || !player2Secret) {
    console.log('\nNote: player secrets were generated for this run only.');
  }
}

main().catch((err) => {
  console.error('\n❌ E2E failed');
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
