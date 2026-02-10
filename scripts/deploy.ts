#!/usr/bin/env bun

/**
 * Deploy script for Soroban contracts.
 *
 * Deploys selected contracts to a chosen Stellar network and writes
 * deployment metadata to deployment.json and .env.
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile, getEnvValue } from './utils/env';
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

type StellarKeypair = {
  publicKey(): string;
  secret(): string;
};

type StellarKeypairFactory = {
  random(): StellarKeypair;
  fromSecret(secret: string): StellarKeypair;
};

async function loadKeypairFactory(): Promise<StellarKeypairFactory> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    return sdk.Keypair;
  } catch (error) {
    console.warn("⚠️  @stellar/stellar-sdk is not installed. Running `bun install`...");
    try {
      await $`bun install`;
      const sdk = await import("@stellar/stellar-sdk");
      return sdk.Keypair;
    } catch (installError) {
      console.error("❌ Failed to load @stellar/stellar-sdk.");
      console.error("Run `bun install` in the repository root, then retry.");
      process.exit(1);
    }
  }
}

type NetworkName = "testnet" | "futurenet" | "mainnet";

type NetworkPreset = {
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  friendbotUrl: string | null;
  existingGameHubId: string;
};

const NETWORK_PRESETS: Record<NetworkName, NetworkPreset> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    existingGameHubId: "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG",
  },
  futurenet: {
    rpcUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    horizonUrl: "https://horizon-futurenet.stellar.org",
    friendbotUrl: "https://friendbot-futurenet.stellar.org",
    existingGameHubId: "",
  },
  mainnet: {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    friendbotUrl: null,
    existingGameHubId: "",
  },
};

function usage() {
  console.log(`
Usage: bun run deploy [options] [contract-name...]

Options:
  --force                            Force redeploy selected contracts
  --network <testnet|futurenet|mainnet> (default: futurenet)
  --rpc-url <url>                    Override RPC URL
  --network-passphrase <passphrase>  Override network passphrase
  --horizon-url <url>                Override Horizon URL used for account checks
  --friendbot-url <url>              Override Friendbot URL
  --existing-game-hub <contract-id>  Prefer this Game Hub contract ID

Examples:
  bun run deploy
  bun run deploy --network futurenet
  bun run deploy --network futurenet --rpc-url https://rpc-futurenet.stellar.org
  bun run deploy number-guess
  bun run deploy twenty-one number-guess
  bun run deploy --network futurenet --force rps_game ultrahonk_soroban_contract
`);
}

function readFlagValue(rawArgs: string[], index: number, flag: string): string {
  const value = rawArgs[index + 1];
  if (!value || value.startsWith("-")) {
    console.error(`❌ Missing value for ${flag}`);
    usage();
    process.exit(1);
  }
  return value;
}

function isNetworkName(value: string): value is NetworkName {
  return value === "testnet" || value === "futurenet" || value === "mainnet";
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  usage();
  process.exit(0);
}

let forceRedeploy = false;
let networkName: NetworkName = "futurenet";
let rpcUrlOverride: string | null = null;
let networkPassphraseOverride: string | null = null;
let horizonUrlOverride: string | null = null;
let friendbotUrlOverride: string | null = null;
let existingGameHubOverride: string | null = null;
const args: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  switch (arg) {
    case "--force":
      forceRedeploy = true;
      break;
    case "--network":
    case "-n": {
      const value = readFlagValue(rawArgs, i, arg);
      if (!isNetworkName(value)) {
        console.error(`❌ Unsupported network: ${value}`);
        usage();
        process.exit(1);
      }
      networkName = value;
      i++;
      break;
    }
    case "--rpc-url":
      rpcUrlOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    case "--network-passphrase":
      networkPassphraseOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    case "--horizon-url":
      horizonUrlOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    case "--friendbot-url":
      friendbotUrlOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    case "--existing-game-hub":
      existingGameHubOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    default:
      args.push(arg);
      break;
  }
}

const preset = NETWORK_PRESETS[networkName];
const NETWORK = networkName;
const RPC_URL = rpcUrlOverride ?? preset.rpcUrl;
const NETWORK_PASSPHRASE = networkPassphraseOverride ?? preset.networkPassphrase;
const HORIZON_URL = horizonUrlOverride ?? preset.horizonUrl;
const FRIEND_BOT_URL = friendbotUrlOverride === ""
  ? null
  : friendbotUrlOverride ?? preset.friendbotUrl;
const EXISTING_GAME_HUB_CONTRACT_ID = existingGameHubOverride ?? preset.existingGameHubId;

console.log(`🚀 Deploying contracts to Stellar ${NETWORK}...\n`);
console.log(`RPC: ${RPC_URL}`);
console.log(`Passphrase: ${NETWORK_PASSPHRASE}`);
console.log(`Horizon: ${HORIZON_URL}`);
console.log(`Friendbot: ${FRIEND_BOT_URL ?? "disabled"}\n`);

const Keypair = await loadKeypairFactory();

const VERIFIER_PACKAGE = 'ultrahonk_soroban_contract';
const RPS_GAME_PACKAGE = 'rps_game';
const VK_PATH = 'circuits/rps_commit/artifacts/vk.bin';
const COMMIT_WINDOW = 100;
const REVEAL_WINDOW = 100;

function extractWasmHash(output: string): string {
  const match = output.match(/[0-9a-fA-F]{64}/);
  if (!match) {
    throw new Error(`Failed to parse WASM hash from output:\n${output}`);
  }
  return match[0];
}

function extractContractId(output: string): string {
  const match = output.match(/C[A-Z2-7]{55}/);
  if (!match) {
    throw new Error(`Failed to parse contract ID from output:\n${output}`);
  }
  return match[0];
}

function buildFriendbotUrl(address: string): string {
  if (!FRIEND_BOT_URL) {
    throw new Error("Friendbot is not configured for this network");
  }
  const separator = FRIEND_BOT_URL.includes("?") ? "&" : "?";
  return `${FRIEND_BOT_URL}${separator}addr=${encodeURIComponent(address)}`;
}

async function accountExists(address: string): Promise<boolean> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`, { method: 'GET' });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon error ${res.status} checking ${address}`);
  return true;
}

async function ensureAccountFunded(address: string): Promise<void> {
  if (await accountExists(address)) return;
  if (!FRIEND_BOT_URL) {
    throw new Error(`Account ${address} does not exist and friendbot is disabled`);
  }
  console.log(`💰 Funding ${address} via friendbot...`);
  const fundRes = await fetch(buildFriendbotUrl(address), { method: 'GET' });
  if (!fundRes.ok) {
    throw new Error(`Friendbot funding failed (${fundRes.status}) for ${address}`);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    if (await accountExists(address)) return;
  }
  throw new Error(`Funded ${address} but it still doesn't appear on Horizon yet`);
}

async function contractExists(contractId: string): Promise<boolean> {
  const tmpPath = join(tmpdir(), `stellar-contract-${contractId}.wasm`);
  try {
    await $`stellar -q contract fetch --id ${contractId} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE} --out-file ${tmpPath}`;
    return true;
  } catch {
    return false;
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore missing temp file
    }
  }
}

const allContracts = await getWorkspaceContracts();
const selection = selectContracts(allContracts, args);
if (selection.unknown.length > 0 || selection.ambiguous.length > 0) {
  console.error("❌ Error: Unknown or ambiguous contract names.");
  if (selection.unknown.length > 0) {
    console.error("Unknown:");
    for (const name of selection.unknown) console.error(`  - ${name}`);
  }
  if (selection.ambiguous.length > 0) {
    console.error("Ambiguous:");
    for (const entry of selection.ambiguous) {
      console.error(`  - ${entry.target}: ${entry.matches.join(", ")}`);
    }
  }
  console.error(`\nAvailable contracts: ${listContractNames(allContracts)}`);
  process.exit(1);
}

const contracts = selection.contracts;
const wantsVerifier = contracts.some((c) => c.packageName === VERIFIER_PACKAGE);
const wantsRpsGame = contracts.some((c) => c.packageName === RPS_GAME_PACKAGE);
const wantsMockHub = contracts.some((c) => c.isMockHub);
const forceMockRedeploy = forceRedeploy && wantsMockHub;
const forceVerifierRedeploy =
  forceRedeploy && (wantsVerifier || wantsRpsGame);
const mock = allContracts.find((c) => c.isMockHub);
if (!mock) {
  console.error("❌ Error: mock-game-hub contract not found in workspace members");
  process.exit(1);
}

const needsMock = contracts.some((c) => !c.isMockHub);
const deployMockRequested = contracts.some((c) => c.isMockHub);
const shouldEnsureMock = deployMockRequested || needsMock;

// Check required WASM files exist for selected contracts (non-mock first)
const missingWasm: string[] = [];
for (const contract of contracts) {
  if (contract.isMockHub) continue;
  if (!await Bun.file(contract.wasmPath).exists()) missingWasm.push(contract.wasmPath);
}
if (missingWasm.length > 0) {
  console.error("❌ Error: Missing WASM build outputs:");
  for (const p of missingWasm) console.error(`  - ${p}`);
  console.error("\nRun 'bun run build [contract-name]' first");
  process.exit(1);
}

// Create three network identities: admin, player1, player2
// Admin signs deployments directly via secret key (no CLI identity required).
// Player1 and player2 are keypairs for frontend dev use.
const walletAddresses: Record<string, string> = {};
const walletSecrets: Record<string, string> = {};

// Load existing secrets from .env if available
let existingSecrets: Record<string, string | null> = {
  player1: null,
  player2: null,
};

const existingEnv = await readEnvFile('.env');
const envNetworkPassphrase = getEnvValue(existingEnv, "VITE_NETWORK_PASSPHRASE");
const envMatchesNetwork = !!envNetworkPassphrase && envNetworkPassphrase === NETWORK_PASSPHRASE;
if (!envMatchesNetwork && envNetworkPassphrase) {
  console.log("ℹ️  .env is for a different network; ignoring previous contract IDs from .env.");
}
for (const identity of ['player1', 'player2']) {
  const key = `VITE_DEV_${identity.toUpperCase()}_SECRET`;
  const v = getEnvValue(existingEnv, key);
  if (v && v !== 'NOT_AVAILABLE') existingSecrets[identity] = v;
}

// Load existing deployment info so partial deploys can preserve other IDs.
const existingContractIds: Record<string, string> = {};
let existingDeployment: any = null;
let existingDeploymentMatchesNetwork = false;
if (existsSync("deployment.json")) {
  try {
    existingDeployment = await Bun.file("deployment.json").json();
    const deploymentMatchesNetwork =
      existingDeployment?.network === NETWORK
      && existingDeployment?.networkPassphrase === NETWORK_PASSPHRASE;
    existingDeploymentMatchesNetwork = deploymentMatchesNetwork;

    if (deploymentMatchesNetwork) {
      if (existingDeployment?.contracts && typeof existingDeployment.contracts === "object") {
        Object.assign(existingContractIds, existingDeployment.contracts);
      } else {
        // Backwards compatible fallback
        if (existingDeployment?.mockGameHubId) existingContractIds["mock-game-hub"] = existingDeployment.mockGameHubId;
        if (existingDeployment?.twentyOneId) existingContractIds["twenty-one"] = existingDeployment.twentyOneId;
        if (existingDeployment?.numberGuessId) existingContractIds["number-guess"] = existingDeployment.numberGuessId;
      }
    } else {
      console.log("ℹ️  deployment.json is for a different network; ignoring previous contract IDs.");
    }
  } catch (error) {
    console.warn("⚠️  Warning: Failed to parse deployment.json, continuing...");
  }
}

for (const contract of allContracts) {
  if (existingContractIds[contract.packageName]) continue;
  if (!envMatchesNetwork) continue;
  const envId = getEnvValue(existingEnv, `VITE_${contract.envKey}_CONTRACT_ID`);
  if (envId) existingContractIds[contract.packageName] = envId;
}

// Handle admin identity (needs to be in Stellar CLI for deployment)
console.log('Setting up admin identity...');
console.log('📝 Generating new admin identity...');
const adminKeypair = Keypair.random();

walletAddresses.admin = adminKeypair.publicKey();

try {
  await ensureAccountFunded(walletAddresses.admin);
  console.log('✅ admin funded');
} catch (error) {
  console.error('❌ Failed to ensure admin is funded. Deployment cannot proceed.');
  process.exit(1);
}

// Handle player identities (don't need to be in CLI, just keypairs)
for (const identity of ['player1', 'player2']) {
  console.log(`Setting up ${identity}...`);

  let keypair: StellarKeypair;
  if (existingSecrets[identity]) {
    console.log(`✅ Using existing ${identity} from .env`);
    keypair = Keypair.fromSecret(existingSecrets[identity]!);
  } else {
    console.log(`📝 Generating new ${identity}...`);
    keypair = Keypair.random();
  }

  walletAddresses[identity] = keypair.publicKey();
  walletSecrets[identity] = keypair.secret();
  console.log(`✅ ${identity}: ${keypair.publicKey()}`);

  // Ensure player accounts exist on the target network (even if reusing keys from .env)
  try {
    await ensureAccountFunded(keypair.publicKey());
    console.log(`✅ ${identity} funded\n`);
  } catch (error) {
    console.warn(`⚠️  Warning: Failed to ensure ${identity} is funded, continuing anyway...`);
  }
}

// Save to deployment.json and .env for setup script to use
console.log("🔐 Player secret keys will be saved to .env (gitignored)\n");

console.log("💼 Wallet addresses:");
console.log(`  Admin:   ${walletAddresses.admin}`);
console.log(`  Player1: ${walletAddresses.player1}`);
console.log(`  Player2: ${walletAddresses.player2}\n`);

// Use admin secret for contract deployment
const adminAddress = walletAddresses.admin;
const adminSecret = adminKeypair.secret();

const deployed: Record<string, string> = { ...existingContractIds };

// Ensure mock Game Hub exists so we can pass it into game constructors.
let mockGameHubId = existingContractIds[mock.packageName] || "";
if (shouldEnsureMock) {
  if (!forceMockRedeploy) {
    const candidateMockIds = [
      existingContractIds[mock.packageName],
      existingDeploymentMatchesNetwork ? existingDeployment?.mockGameHubId : undefined,
      EXISTING_GAME_HUB_CONTRACT_ID,
    ].filter(Boolean) as string[];

    for (const candidate of candidateMockIds) {
      if (await contractExists(candidate)) {
        mockGameHubId = candidate;
        break;
      }
    }
  }

  if (mockGameHubId && !forceMockRedeploy) {
    deployed[mock.packageName] = mockGameHubId;
    console.log(`✅ Using existing ${mock.packageName} on ${NETWORK}: ${mockGameHubId}\n`);
  } else {
    if (!await Bun.file(mock.wasmPath).exists()) {
      console.error("❌ Error: Missing WASM build output for mock-game-hub:");
      console.error(`  - ${mock.wasmPath}`);
      console.error("\nRun 'bun run build mock-game-hub' first");
      process.exit(1);
    }

    if (forceMockRedeploy) {
      console.warn(`⚠️  --force enabled. Redeploying ${mock.packageName}...`);
    } else {
      console.warn(`⚠️  ${mock.packageName} not found on ${NETWORK} (archived or reset). Deploying a new one...`);
    }
    console.log(`Deploying ${mock.packageName}...`);
    try {
      const result =
        await $`stellar contract deploy --wasm ${mock.wasmPath} --source-account ${adminSecret} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE}`.text();
      mockGameHubId = extractContractId(result);
      deployed[mock.packageName] = mockGameHubId;
      console.log(`✅ ${mock.packageName} deployed: ${mockGameHubId}\n`);
    } catch (error) {
      console.error(`❌ Failed to deploy ${mock.packageName}:`, error);
      process.exit(1);
    }
  }
}

async function verifierSupportsPoseidon2(contractId: string): Promise<boolean> {
  const tmpBindingsDir = await mkdtemp(join(tmpdir(), "verifier-bindings-"));
  try {
    await $`stellar contract bindings typescript --contract-id ${contractId} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE} --output-dir ${tmpBindingsDir} --overwrite`.text();
    const bindingsPath = join(tmpBindingsDir, "src", "index.ts");
    if (!existsSync(bindingsPath)) {
      return false;
    }

    const bindingsSource = await Bun.file(bindingsPath).text();
    return bindingsSource.includes("verify_proof_poseidon2");
  } catch {
    return false;
  } finally {
    await rm(tmpBindingsDir, { recursive: true, force: true });
  }
}

let verifierContractId = existingContractIds[VERIFIER_PACKAGE] || "";
if (wantsVerifier || wantsRpsGame) {
  if (!forceVerifierRedeploy) {
    const candidateVerifierIds = [
      existingContractIds[VERIFIER_PACKAGE],
      existingDeploymentMatchesNetwork ? existingDeployment?.contracts?.[VERIFIER_PACKAGE] : undefined,
    ].filter(Boolean) as string[];

    for (const candidate of candidateVerifierIds) {
      if (await contractExists(candidate)) {
        if (!await verifierSupportsPoseidon2(candidate)) {
          console.warn(
            `⚠️  Existing verifier ${candidate} does not expose verify_proof_poseidon2. Will redeploy verifier.\n`
          );
          continue;
        }
        verifierContractId = candidate;
        break;
      }
    }
  }

  if (verifierContractId && !forceVerifierRedeploy) {
    deployed[VERIFIER_PACKAGE] = verifierContractId;
    console.log(`✅ Using existing ${VERIFIER_PACKAGE} on ${NETWORK}: ${verifierContractId}\n`);
  } else {
    const verifierInfo = allContracts.find((c) => c.packageName === VERIFIER_PACKAGE);
    if (!verifierInfo) {
      console.error(`❌ Error: Missing ${VERIFIER_PACKAGE} contract info in workspace.`);
      process.exit(1);
    }

    if (!await Bun.file(verifierInfo.wasmPath).exists()) {
      console.error("❌ Error: Missing WASM build output for verifier:");
      console.error(`  - ${verifierInfo.wasmPath}`);
      console.error("\nRun 'bun run build verifier' first");
      process.exit(1);
    }

    if (!await Bun.file(VK_PATH).exists()) {
      console.error("❌ Error: Missing verification key file:");
      console.error(`  - ${VK_PATH}`);
      console.error("\nRun 'bun run compile' + 'bun run artifacts' in circuits/rps_commit first");
      process.exit(1);
    }

    if (forceVerifierRedeploy) {
      console.warn(`⚠️  --force enabled. Redeploying ${VERIFIER_PACKAGE}...`);
    } else {
      console.log(`Deploying ${VERIFIER_PACKAGE}...`);
    }
    try {
      console.log("  Uploading WASM...");
      const uploadResult =
        await $`stellar contract upload --wasm ${verifierInfo.wasmPath} --source-account ${adminSecret} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE}`.text();
      const wasmHash = extractWasmHash(uploadResult);
      console.log(`  WASM hash: ${wasmHash}`);

      console.log("  Deploying and initializing...");
      const deployResult =
        await $`stellar contract deploy --wasm-hash ${wasmHash} --source-account ${adminSecret} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE} -- --vk_bytes-file-path ${VK_PATH}`.text();
      verifierContractId = extractContractId(deployResult);
      deployed[VERIFIER_PACKAGE] = verifierContractId;
      console.log(`✅ ${VERIFIER_PACKAGE} deployed: ${verifierContractId}\n`);
    } catch (error) {
      console.error(`❌ Failed to deploy ${VERIFIER_PACKAGE}:`, error);
      process.exit(1);
    }
  }
}

for (const contract of contracts) {
  if (contract.isMockHub) continue;
  if (contract.packageName === VERIFIER_PACKAGE) continue;

  console.log(`Deploying ${contract.packageName}...`);
  try {
    console.log("  Uploading WASM...");
    const uploadResult =
      await $`stellar contract upload --wasm ${contract.wasmPath} --source-account ${adminSecret} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE}`.text();
    const wasmHash = extractWasmHash(uploadResult);
    console.log(`  WASM hash: ${wasmHash}`);

    if (contract.packageName === RPS_GAME_PACKAGE) {
      console.log("  Deploying (no constructor)...");
      const deployResult =
        await $`stellar contract deploy --wasm-hash ${wasmHash} --source-account ${adminSecret} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE}`.text();
      const contractId = extractContractId(deployResult);
      deployed[contract.packageName] = contractId;
      console.log(`✅ ${contract.packageName} deployed: ${contractId}\n`);

      if (!verifierContractId) {
        console.error("❌ Error: verifier contract not available for rps_game init.");
        process.exit(1);
      }

      console.log("  Initializing rps_game...");
      try {
        await $`stellar contract invoke --id ${contractId} --source-account ${adminSecret} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE} -- init --game_hub ${mockGameHubId} --verifier ${verifierContractId} --commit_window ${COMMIT_WINDOW} --reveal_window ${REVEAL_WINDOW}`;
      } catch (error) {
        const message = String(error);
        if (!message.includes("AlreadyInitialized") && !message.includes("Error(Contract, #1)")) {
          console.error("❌ Failed to initialize rps_game:", error);
          process.exit(1);
        }
      }
    } else {
      console.log("  Deploying and initializing...");
      const deployResult =
        await $`stellar contract deploy --wasm-hash ${wasmHash} --source-account ${adminSecret} --rpc-url ${RPC_URL} --network-passphrase ${NETWORK_PASSPHRASE} -- --admin ${adminAddress} --game-hub ${mockGameHubId}`.text();
      const contractId = extractContractId(deployResult);
      deployed[contract.packageName] = contractId;
      console.log(`✅ ${contract.packageName} deployed: ${contractId}\n`);
    }
  } catch (error) {
    console.error(`❌ Failed to deploy ${contract.packageName}:`, error);
    process.exit(1);
  }
}

console.log("🎉 Deployment complete!\n");
console.log("Contract IDs:");
const outputContracts = new Set<string>();
for (const contract of contracts) outputContracts.add(contract.packageName);
if (shouldEnsureMock) outputContracts.add(mock.packageName);
for (const contract of allContracts) {
  if (!outputContracts.has(contract.packageName)) continue;
  const id = deployed[contract.packageName];
  if (id) console.log(`  ${contract.packageName}: ${id}`);
}

const twentyOneId = deployed["twenty-one"] || "";
const numberGuessId = deployed["number-guess"] || "";

const deploymentContracts = allContracts.reduce<Record<string, string>>((acc, contract) => {
  acc[contract.packageName] = deployed[contract.packageName] || "";
  return acc;
}, {});

const deploymentInfo = {
  mockGameHubId,
  twentyOneId,
  numberGuessId,
  contracts: deploymentContracts,
  network: NETWORK,
  rpcUrl: RPC_URL,
  horizonUrl: HORIZON_URL,
  friendbotUrl: FRIEND_BOT_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  wallets: {
    admin: walletAddresses.admin,
    player1: walletAddresses.player1,
    player2: walletAddresses.player2,
  },
  deployedAt: new Date().toISOString(),
};

await Bun.write('deployment.json', JSON.stringify(deploymentInfo, null, 2) + '\n');
console.log("\n✅ Wrote deployment info to deployment.json");

const contractEnvLines = allContracts
  .map((c) => `VITE_${c.envKey}_CONTRACT_ID=${deploymentContracts[c.packageName] || ""}`)
  .join("\n");

const envContent = `# Auto-generated by deploy script
# Do not edit manually - run 'bun run deploy' (or 'bun run setup') to regenerate
# WARNING: This file contains secret keys. Never commit to git!

VITE_SOROBAN_RPC_URL=${RPC_URL}
VITE_HORIZON_URL=${HORIZON_URL}
VITE_FRIENDBOT_URL=${FRIEND_BOT_URL ?? ""}
VITE_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
${contractEnvLines}

# Dev wallet addresses for testing
VITE_DEV_ADMIN_ADDRESS=${walletAddresses.admin}
VITE_DEV_PLAYER1_ADDRESS=${walletAddresses.player1}
VITE_DEV_PLAYER2_ADDRESS=${walletAddresses.player2}

# Dev wallet secret keys (WARNING: Never commit this file!)
VITE_DEV_PLAYER1_SECRET=${walletSecrets.player1}
VITE_DEV_PLAYER2_SECRET=${walletSecrets.player2}
`;

await Bun.write('.env', envContent + '\n');
console.log("✅ Wrote secrets to .env (gitignored)");

export { mockGameHubId, deployed };
