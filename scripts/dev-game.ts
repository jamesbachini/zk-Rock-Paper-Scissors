#!/usr/bin/env bun

import { $ } from 'bun';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

function usage() {
  console.log(`\nUsage: bun run dev:game <game-slug> [--install]\n`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const gameSlug = args[0];
const shouldInstall = args.includes('--install');
const repoRoot = process.cwd();
const frontendDir = path.join(repoRoot, `${gameSlug}-frontend`);

if (!existsSync(frontendDir)) {
  const candidates = readdirSync(repoRoot)
    .filter((name) => name.endsWith('-frontend'))
    .filter((name) => statSync(path.join(repoRoot, name)).isDirectory());

  console.error(`\n❌ Frontend not found: ${frontendDir}`);
  if (candidates.length > 0) {
    console.error(`Available frontends: ${candidates.join(', ')}`);
  }
  process.exit(1);
}

if (!existsSync(path.join(repoRoot, '.env'))) {
  console.warn('\n⚠️  Root .env not found. Run bun run setup to deploy contracts and configure dev wallets.');
}

const nodeModulesPath = path.join(frontendDir, 'node_modules');
if (shouldInstall || !existsSync(nodeModulesPath)) {
  console.log(`\n📦 Installing frontend dependencies in ${frontendDir}...`);
  await $`bun install`.cwd(frontendDir);
}

console.log(`\n🚀 Starting ${gameSlug} frontend...`);
await $`bun run dev`.cwd(frontendDir);
