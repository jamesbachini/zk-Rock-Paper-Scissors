#!/usr/bin/env bun

/**
 * One-command local dev flow for ZKRPS.
 *
 * This script:
 * 1) Builds required contracts (mock-game-hub, verifier, rps_game)
 * 2) Force redeploys those contracts to testnet
 * 3) Regenerates rps_game bindings and syncs frontend bindings
 * 4) Starts zkrps-frontend with the freshly written root .env
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { readEnvFile, getEnvValue } from "./utils/env";

function usage() {
  console.log(`
Usage: bun run dev:zkrps

This command force redeploys:
  - mock-game-hub
  - ultrahonk_soroban_contract
  - rps_game

Then it starts:
  - zkrps-frontend
`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const frontendDir = "zkrps-frontend";
if (!existsSync(frontendDir)) {
  console.error(`❌ Frontend directory not found: ${frontendDir}`);
  process.exit(1);
}

console.log("🎮 ZKRPS redeploy + dev startup\n");

if (!existsSync("node_modules")) {
  console.log("📦 Installing root dependencies...");
  await $`bun install`;
}

if (!existsSync(`${frontendDir}/node_modules`)) {
  console.log("📦 Installing frontend dependencies...");
  await $`bun install`.cwd(frontendDir);
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 1/4: Build required contracts");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
await $`bun run build mock-game-hub ultrahonk_soroban_contract rps_game`;

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 2/4: Force redeploy contracts");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
await $`bun run deploy --force mock-game-hub ultrahonk_soroban_contract rps_game`;

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 3/4: Refresh rps_game bindings");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
await $`bun run bindings rps_game`;
const generatedBindings = "bindings/rps_game/src/index.ts";
const frontendBindings = `${frontendDir}/src/games/zkrps/bindings.ts`;
if (!existsSync(generatedBindings)) {
  console.error(`❌ Expected generated bindings at ${generatedBindings}, but file was not found.`);
  process.exit(1);
}
await Bun.write(frontendBindings, await Bun.file(generatedBindings).text());

const env = await readEnvFile(".env");
const mockHubId = getEnvValue(env, "VITE_MOCK_GAME_HUB_CONTRACT_ID");
const verifierId = getEnvValue(env, "VITE_ULTRAHONK_SOROBAN_CONTRACT_CONTRACT_ID");
const rpsId = getEnvValue(env, "VITE_RPS_GAME_CONTRACT_ID");

if (!mockHubId || !verifierId || !rpsId) {
  console.error("❌ Missing contract IDs in root .env after deploy.");
  console.error("Expected:");
  console.error("  - VITE_MOCK_GAME_HUB_CONTRACT_ID");
  console.error("  - VITE_ULTRAHONK_SOROBAN_CONTRACT_CONTRACT_ID");
  console.error("  - VITE_RPS_GAME_CONTRACT_ID");
  process.exit(1);
}

console.log("✅ Active contract IDs (root .env):");
console.log(`  mock-game-hub: ${mockHubId}`);
console.log(`  ultrahonk_soroban_contract: ${verifierId}`);
console.log(`  rps_game: ${rpsId}`);

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Step 4/4: Start zkrps frontend");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
await $`bun run dev`.cwd(frontendDir);
