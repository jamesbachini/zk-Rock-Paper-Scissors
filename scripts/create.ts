#!/usr/bin/env bun

import { $ } from 'bun';
import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function usage() {
  console.log(`\nUsage: bun run create <game-slug> [--force] [--skip-setup]\n`);
}

function isValidSlug(slug: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug);
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function pascalFromSlug(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function camelFromSlug(slug: string): string {
  const pascal = pascalFromSlug(slug);
  return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : pascal;
}

function toEnvKey(slug: string): string {
  return slug.replace(/-/g, '_').toUpperCase();
}

function shouldSkip(name: string): boolean {
  const skipNames = new Set([
    'node_modules',
    'dist',
    'dist-node',
    '.turbo',
    '.git',
  ]);
  if (skipNames.has(name)) return true;
  if (name === 'tsconfig.tsbuildinfo') return true;
  return false;
}

function copyDir(src: string, dest: string) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      const contents = readFileSync(srcPath);
      writeFileSync(destPath, contents);
    }
  }
}

function replaceAll(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(replacements)) {
    out = out.split(from).join(to);
  }
  return out;
}

function replaceInFile(filePath: string, replacements: Record<string, string>) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  const updated = replaceAll(text, replacements);
  if (updated !== text) {
    writeFileSync(filePath, updated);
  }
}

function replaceInDir(dir: string, replacements: Record<string, string>) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replaceInDir(entryPath, replacements);
    } else if (entry.isFile()) {
      replaceInFile(entryPath, replacements);
    }
  }
}

function renameIfExists(fromPath: string, toPath: string) {
  if (!existsSync(fromPath)) return;
  if (fromPath === toPath) return;
  rmSync(toPath, { recursive: true, force: true });
  mkdirSync(path.dirname(toPath), { recursive: true });
  renameSync(fromPath, toPath);
}

function updateWorkspaceMembers(repoRoot: string, gameSlug: string) {
  const cargoPath = path.join(repoRoot, 'Cargo.toml');
  const cargoText = readFileSync(cargoPath, 'utf8');
  const memberLine = `  "contracts/${gameSlug}",`;

  if (cargoText.includes(memberLine)) return;

  const membersMatch = cargoText.match(/members\s*=\s*\[[\s\S]*?\]/m);
  if (!membersMatch) {
    throw new Error('Unable to locate workspace members in Cargo.toml');
  }

  const block = membersMatch[0];
  const insertIndex = block.lastIndexOf(']');
  if (insertIndex < 0) {
    throw new Error('Malformed workspace members list in Cargo.toml');
  }

  const updatedBlock = `${block.slice(0, insertIndex)}${memberLine}\n${block.slice(insertIndex)}`;
  const updatedCargo = cargoText.replace(block, updatedBlock);
  writeFileSync(cargoPath, updatedCargo);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const gameSlug = args[0];
const force = args.includes('--force');
const skipSetup = args.includes('--skip-setup') || args.includes('--no-setup');

if (!isValidSlug(gameSlug)) {
  console.error(`\n❌ Invalid game slug: ${gameSlug}`);
  console.error('Use lowercase letters, numbers, and dashes only, starting with a letter (e.g. my-game).');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const contractsRoot = path.join(repoRoot, 'contracts');
const exampleContractDir = path.join(contractsRoot, 'number-guess');
const newContractDir = path.join(contractsRoot, gameSlug);
const frontendTemplateDir = path.join(repoRoot, 'template_frontend');
const frontendSlug = `${gameSlug}-frontend`;
const newFrontendDir = path.join(repoRoot, frontendSlug);

if (!existsSync(exampleContractDir)) {
  console.error(`\n❌ Missing number-guess example contract at ${exampleContractDir}`);
  process.exit(1);
}

if (!existsSync(frontendTemplateDir)) {
  console.error(`\n❌ Missing number-guess frontend example at ${frontendTemplateDir}`);
  process.exit(1);
}

if (existsSync(newContractDir)) {
  if (!force) {
    console.error(`\n❌ Contract already exists: ${newContractDir}`);
    console.error('Use --force to overwrite.');
    process.exit(1);
  }
  rmSync(newContractDir, { recursive: true, force: true });
}

if (existsSync(newFrontendDir)) {
  if (!force) {
    console.error(`\n❌ Frontend already exists: ${newFrontendDir}`);
    console.error('Use --force to overwrite.');
    process.exit(1);
  }
  rmSync(newFrontendDir, { recursive: true, force: true });
}

console.log(`\n🧩 Creating game: ${gameSlug}`);

console.log('  • Copying number-guess contract...');
copyDir(exampleContractDir, newContractDir);

const pascalName = pascalFromSlug(gameSlug);
const titleName = titleCaseFromSlug(gameSlug);
const camelName = camelFromSlug(gameSlug);
const envKey = toEnvKey(gameSlug);

const replacements = {
  'number-guess': gameSlug,
  'NumberGuess': pascalName || 'Game',
  'Number Guess': titleName || 'Game',
  'numberGuess': camelName || 'game',
  'NUMBER_GUESS': envKey || 'GAME',
};
replaceInDir(newContractDir, replacements);

console.log('  • Registering contract in workspace...');
updateWorkspaceMembers(repoRoot, gameSlug);

console.log('  • Copying number-guess frontend...');
copyDir(frontendTemplateDir, newFrontendDir);

const frontendPackagePath = path.join(newFrontendDir, 'package.json');
if (existsSync(frontendPackagePath)) {
  const pkg = JSON.parse(readFileSync(frontendPackagePath, 'utf8')) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  pkg.name = `${gameSlug}-frontend`;
  if (pkg.scripts && pkg.scripts['build:docs']) {
    delete pkg.scripts['build:docs'];
  }
  writeFileSync(frontendPackagePath, JSON.stringify(pkg, null, 2) + '\n');
}

const gamesDir = path.join(newFrontendDir, 'src', 'games');
if (existsSync(gamesDir)) {
  rmSync(gamesDir, { recursive: true, force: true });
}
mkdirSync(gamesDir, { recursive: true });

const exampleGameDir = path.join(frontendTemplateDir, 'src', 'games', 'number-guess');
if (!existsSync(exampleGameDir)) {
  console.error(`\n❌ Missing number-guess game frontend at ${exampleGameDir}`);
  process.exit(1);
}

const newGameDir = path.join(gamesDir, gameSlug);
copyDir(exampleGameDir, newGameDir);

const componentName = `${pascalName}Game`;
const serviceFileBase = `${camelName}Service`;

renameIfExists(
  path.join(newGameDir, 'NumberGuessGame.tsx'),
  path.join(newGameDir, `${componentName}.tsx`)
);
renameIfExists(
  path.join(newGameDir, 'numberGuessService.ts'),
  path.join(newGameDir, `${serviceFileBase}.ts`)
);

replaceInDir(newGameDir, replacements);
replaceInFile(path.join(newFrontendDir, 'src', 'utils', 'constants.ts'), replacements);
replaceInFile(path.join(newFrontendDir, 'src', 'config.ts'), replacements);

const appTemplate = `import { config } from './config';
import { Layout } from './components/Layout';
import { useWallet } from './hooks/useWallet';
import { ${componentName} } from './games/${gameSlug}/${componentName}';

const GAME_ID = '${gameSlug}';
const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || '${titleName}';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'On-chain game on Stellar';

export default function App() {
  const { publicKey, isConnected, isConnecting, error, isDevModeAvailable } = useWallet();
  const userAddress = publicKey ?? '';
  const contractId = config.contractIds[GAME_ID] || '';
  const hasContract = contractId && contractId !== 'YOUR_CONTRACT_ID';
  const devReady = isDevModeAvailable();

  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      {!hasContract ? (
        <div className="card">
          <h3 className="gradient-text">Contract Not Configured</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '1rem' }}>
            Run <code>bun run setup</code> to deploy and configure testnet contract IDs, or set
            <code>VITE_${envKey}_CONTRACT_ID</code> in the root <code>.env</code>.
          </p>
        </div>
      ) : !devReady ? (
        <div className="card">
          <h3 className="gradient-text">Dev Wallets Missing</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
            Run <code>bun run setup</code> to generate dev wallets for Player 1 and Player 2.
          </p>
        </div>
      ) : !isConnected ? (
        <div className="card">
          <h3 className="gradient-text">Connecting Dev Wallet</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
            The dev wallet switcher auto-connects Player 1. Use the switcher to toggle players.
          </p>
          {error && <div className="notice error" style={{ marginTop: '1rem' }}>{error}</div>}
          {isConnecting && <div className="notice info" style={{ marginTop: '1rem' }}>Connecting...</div>}
        </div>
      ) : (
        <${componentName}
          userAddress={userAddress}
          currentEpoch={1}
          availablePoints={1000000000n}
          onStandingsRefresh={() => {}}
          onGameComplete={() => {}}
        />
      )}
    </Layout>
  );
}
`;

writeFileSync(path.join(newFrontendDir, 'src', 'App.tsx'), appTemplate);

const indexPath = path.join(newFrontendDir, 'index.html');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  let updatedHtml = html;

  if (updatedHtml.includes('<title>')) {
    updatedHtml = updatedHtml.replace(/<title>.*<\/title>/, `<title>${titleName}</title>`);
  }

  if (updatedHtml !== html) {
    writeFileSync(indexPath, updatedHtml);
  }
}

async function runSetupSteps() {
  console.log('  • Building contract...');
  await $`bun run build ${gameSlug}`.cwd(repoRoot);

  console.log('  • Deploying contract to testnet...');
  await $`bun run deploy ${gameSlug}`.cwd(repoRoot);

  console.log('  • Generating bindings...');
  await $`bun run bindings ${gameSlug}`.cwd(repoRoot);

  const wasmName = gameSlug.replace(/-/g, '_');
  const bindingsSource = path.join(repoRoot, 'bindings', wasmName, 'src', 'index.ts');
  const bindingsDest = path.join(newGameDir, 'bindings.ts');

  if (existsSync(bindingsSource)) {
    writeFileSync(bindingsDest, readFileSync(bindingsSource, 'utf8'));
    console.log('  • Updated frontend bindings');
  } else {
    console.warn(`  ⚠️  Bindings file not found at ${bindingsSource}`);
  }
}

console.log('✅ Contract and frontend created');
if (!skipSetup) {
  console.log('🚀 Running build + deploy + bindings...');
  try {
    await runSetupSteps();
  } catch (error) {
    console.error('\n❌ Setup failed. You can retry manually with:');
    console.error(`  bun run build ${gameSlug}`);
    console.error(`  bun run deploy ${gameSlug}`);
    console.error(`  bun run bindings ${gameSlug}`);
    process.exit(1);
  }
}

console.log('Next steps:');
console.log(`  1) Review contracts/${gameSlug}/src/lib.rs`);
if (skipSetup) {
  console.log(`  2) bun run build ${gameSlug}`);
  console.log(`  3) bun run deploy ${gameSlug}`);
  console.log(`  4) bun run bindings ${gameSlug}`);
  console.log(`  5) bun run dev:game ${gameSlug}`);
} else {
  console.log(`  2) bun run dev:game ${gameSlug}`);
}
console.log(`     (or cd ${frontendSlug} && bun install && bun run dev)`);
