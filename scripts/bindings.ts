#!/usr/bin/env bun

/**
 * Generate TypeScript bindings for contracts
 *
 * Generates type-safe client bindings from deployed contracts
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { readEnvFile, getEnvValue } from "./utils/env";
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

function usage() {
  console.log(`
Usage: bun run bindings [options] [contract-name...]

Options:
  --rpc-url <url>                    Override RPC URL
  --network-passphrase <passphrase>  Override network passphrase
  --network <name>                   Use named network from local Stellar CLI config

Examples:
  bun run bindings
  bun run bindings --network futurenet
  bun run bindings number-guess
  bun run bindings twenty-one number-guess
`);
}

console.log("📦 Generating TypeScript bindings...\n");

const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  usage();
  process.exit(0);
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    console.error(`❌ Missing value for ${flag}`);
    usage();
    process.exit(1);
  }
  return value;
}

let rpcUrlOverride: string | null = null;
let networkPassphraseOverride: string | null = null;
let networkAliasOverride: string | null = null;
const args: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  switch (arg) {
    case "--rpc-url":
      rpcUrlOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    case "--network-passphrase":
      networkPassphraseOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    case "--network":
    case "-n":
      networkAliasOverride = readFlagValue(rawArgs, i, arg);
      i++;
      break;
    default:
      args.push(arg);
      break;
  }
}

const contracts = await getWorkspaceContracts();
const selection = selectContracts(contracts, args);
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
  console.error(`\nAvailable contracts: ${listContractNames(contracts)}`);
  process.exit(1);
}

const contractsToBind = selection.contracts;
const contractIds: Record<string, string> = {};
let rpcUrl = "https://rpc-futurenet.stellar.org";
let networkPassphrase = "Test SDF Future Network ; October 2022";
let networkAlias: string | null = null;

if (existsSync("deployment.json")) {
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
} else {
  const env = await readEnvFile('.env');
  for (const contract of contracts) {
    contractIds[contract.packageName] = getEnvValue(env, `VITE_${contract.envKey}_CONTRACT_ID`);
  }
  rpcUrl = getEnvValue(env, "VITE_SOROBAN_RPC_URL", rpcUrl);
  networkPassphrase = getEnvValue(env, "VITE_NETWORK_PASSPHRASE", networkPassphrase);
}

if (rpcUrlOverride) rpcUrl = rpcUrlOverride;
if (networkPassphraseOverride) networkPassphrase = networkPassphraseOverride;
if (networkAliasOverride) networkAlias = networkAliasOverride;

const missing: string[] = [];
for (const contract of contractsToBind) {
  const id = contractIds[contract.packageName];
  if (!id) missing.push(`VITE_${contract.envKey}_CONTRACT_ID`);
}

if (missing.length > 0) {
  console.error("❌ Error: Missing contract IDs (need either deployment.json or .env):");
  for (const k of missing) console.error(`  - ${k}`);
  process.exit(1);
}

for (const contract of contractsToBind) {
  const contractId = contractIds[contract.packageName];
  console.log(`Generating bindings for ${contract.packageName}...`);
  try {
    if (networkAlias) {
      await $`stellar contract bindings typescript --contract-id ${contractId} --output-dir ${contract.bindingsOutDir} --network ${networkAlias} --overwrite`;
    } else {
      await $`stellar contract bindings typescript --contract-id ${contractId} --output-dir ${contract.bindingsOutDir} --rpc-url ${rpcUrl} --network-passphrase ${networkPassphrase} --overwrite`;
    }
    console.log(`✅ ${contract.packageName} bindings generated\n`);
  } catch (error) {
    console.error(`❌ Failed to generate ${contract.packageName} bindings:`, error);
    process.exit(1);
  }
}

console.log("🎉 Bindings generated successfully!");
console.log("\nGenerated files:");
for (const contract of contractsToBind) {
  console.log(`  - ${contract.bindingsOutDir}/`);
}
