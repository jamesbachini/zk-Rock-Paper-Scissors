#!/usr/bin/env bun

/**
 * Build script for Soroban contracts
 *
 * Builds all Soroban contracts in this repo
 * using the stellar CLI with wasm32v1-none target
 */

import { $ } from "bun";
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

function usage() {
  console.log(`
Usage: bun run build [contract-name...]

Examples:
  bun run build
  bun run build number-guess
  bun run build twenty-one number-guess
`);
}

console.log("🔨 Building Soroban contracts...\n");

// Check if stellar CLI is available
try {
  await $`stellar --version`.quiet();
} catch (error) {
  console.error("❌ Error: stellar CLI not found");
  console.error("Please install it: https://developers.stellar.org/docs/tools/developer-tools");
  process.exit(1);
}

// Check if wasm32v1-none target is installed
try {
  const result = await $`rustup target list --installed`.text();
  if (!result.includes("wasm32v1-none")) {
    console.log("📦 Installing wasm32v1-none target...");
    await $`rustup target add wasm32v1-none`;
  }
} catch (error) {
  console.error("❌ Error checking Rust targets:", error);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
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

const contractsToBuild = selection.contracts;

for (const contract of contractsToBuild) {
  console.log(`Building ${contract.packageName}...`);
  try {
    await $`stellar contract build --manifest-path ${contract.manifestPath} --optimize`;
    console.log(`✅ ${contract.packageName} built\n`);
  } catch (error) {
    console.error(`❌ Failed to build ${contract.packageName}:`, error);
    process.exit(1);
  }
}

console.log("🎉 Contracts built successfully!");
console.log("\nWASM files:");
for (const contract of contractsToBuild) {
  console.log(`  - ${contract.wasmPath}`);
}
