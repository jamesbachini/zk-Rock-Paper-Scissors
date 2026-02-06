#!/usr/bin/env bun

/**
 * One-command setup script
 *
 * This script:
 * 1. Builds contracts
 * 2. Deploys to testnet
 * 3. Generates TypeScript bindings
 * 4. Writes local testnet configuration
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { readEnvFile, getEnvValue } from "./utils/env";
import { getWorkspaceContracts } from "./utils/contracts";

console.log("🎮 Stellar Game Studio Setup\n");
console.log("This will:");
console.log("  0. Install JavaScript dependencies (if needed)");
console.log("  1. Build Soroban contracts");
console.log("  2. Deploy to Stellar testnet");
console.log("  3. Generate TypeScript bindings");
console.log("  4. Write local testnet configuration\n");

// Step 0: Ensure JavaScript dependencies are installed
if (!existsSync("node_modules/@stellar/stellar-sdk")) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Step 0/4: Installing dependencies");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  try {
    await $`bun install`;
  } catch (error) {
    console.error("\n❌ Dependency installation failed. Please check the errors above.");
    process.exit(1);
  }
}

// Step 1: Build contracts
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 1/4: Building contracts");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
try {
  await $`bun run build`;
} catch (error) {
  console.error("\n❌ Build failed. Please check the errors above.");
  process.exit(1);
}

// Step 2: Deploy contracts
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 2/4: Deploying to testnet");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
try {
  await $`bun run deploy`;
} catch (error) {
  console.error("\n❌ Deployment failed. Please check the errors above.");
  process.exit(1);
}

// Step 3: Generate bindings
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 3/4: Generating TypeScript bindings");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
try {
  await $`bun run bindings`;
} catch (error) {
  console.error("\n❌ Bindings generation failed. Please check the errors above.");
  process.exit(1);
}

// Step 4: Configure studio frontend
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 4/4: Writing local configuration");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

let rpcUrl = 'https://soroban-testnet.stellar.org';
let networkPassphrase = 'Test SDF Network ; September 2015';
let wallets: { admin: string; player1: string; player2: string } = { admin: '', player1: '', player2: '' };
const contracts = await getWorkspaceContracts();
const contractIds: Record<string, string> = {};

if (existsSync('deployment.json')) {
  const deploymentInfo = await Bun.file("deployment.json").json();
  if (deploymentInfo?.contracts && typeof deploymentInfo.contracts === 'object') {
    Object.assign(contractIds, deploymentInfo.contracts);
  } else {
    // Backwards compatible fallback
    if (deploymentInfo?.mockGameHubId) contractIds["mock-game-hub"] = deploymentInfo.mockGameHubId;
    if (deploymentInfo?.twentyOneId) contractIds["twenty-one"] = deploymentInfo.twentyOneId;
    if (deploymentInfo?.numberGuessId) contractIds["number-guess"] = deploymentInfo.numberGuessId;
  }
  rpcUrl = deploymentInfo?.rpcUrl || rpcUrl;
  networkPassphrase = deploymentInfo?.networkPassphrase || networkPassphrase;
  wallets = deploymentInfo?.wallets || wallets;
} else {
  const env = await readEnvFile('.env');
  for (const contract of contracts) {
    contractIds[contract.packageName] = getEnvValue(env, `VITE_${contract.envKey}_CONTRACT_ID`);
  }
  rpcUrl = getEnvValue(env, 'VITE_SOROBAN_RPC_URL', rpcUrl);
  networkPassphrase = getEnvValue(env, 'VITE_NETWORK_PASSPHRASE', networkPassphrase);
  wallets = {
    admin: getEnvValue(env, 'VITE_DEV_ADMIN_ADDRESS'),
    player1: getEnvValue(env, 'VITE_DEV_PLAYER1_ADDRESS'),
    player2: getEnvValue(env, 'VITE_DEV_PLAYER2_ADDRESS'),
  };
}

const existingEnv = await readEnvFile('.env');
const walletSecrets = {
  player1: getEnvValue(existingEnv, 'VITE_DEV_PLAYER1_SECRET', 'NOT_AVAILABLE'),
  player2: getEnvValue(existingEnv, 'VITE_DEV_PLAYER2_SECRET', 'NOT_AVAILABLE'),
};

const missingIds: string[] = [];
for (const contract of contracts) {
  if (!contractIds[contract.packageName]) missingIds.push(`VITE_${contract.envKey}_CONTRACT_ID`);
}
if (missingIds.length > 0) {
  console.error("❌ Error: Missing contract IDs (run `bun run deploy` first):");
  for (const k of missingIds) console.error(`  - ${k}`);
  process.exit(1);
}

const contractEnvLines = contracts
  .map((c) => `VITE_${c.envKey}_CONTRACT_ID=${contractIds[c.packageName] || ""}`)
  .join("\n");

const envContent = `# Auto-generated by setup script
# Do not edit manually - run 'bun run setup' to regenerate
# WARNING: This file contains secret keys. Never commit to git!

VITE_SOROBAN_RPC_URL=${rpcUrl}
VITE_NETWORK_PASSPHRASE=${networkPassphrase}
${contractEnvLines}

# Dev wallet addresses for testing
VITE_DEV_ADMIN_ADDRESS=${wallets.admin}
VITE_DEV_PLAYER1_ADDRESS=${wallets.player1}
VITE_DEV_PLAYER2_ADDRESS=${wallets.player2}

# Dev wallet secret keys (WARNING: Never commit this file!)
VITE_DEV_PLAYER1_SECRET=${walletSecrets.player1}
VITE_DEV_PLAYER2_SECRET=${walletSecrets.player2}
`;

await Bun.write(".env", envContent);
console.log("✅ Root .env file created\n");

console.log("🎉 Setup complete!\n");
console.log("Contract IDs:");
for (const contract of contracts) {
  console.log(`  ${contract.packageName}: ${contractIds[contract.packageName]}`);
}
console.log("");
console.log("Next steps:");
console.log("  1) bun run create <game-slug>");
console.log("  2) bun run dev:game <game-slug>");
