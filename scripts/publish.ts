#!/usr/bin/env bun

import { $ } from 'bun';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readEnvFile } from './utils/env';

function usage() {
  console.log(`\nUsage: bun run publish <game-slug> [--out <dir>] [--source <dir>] [--build] [--force]\n`);
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function toEnvKey(slug: string): string {
  return slug.replace(/-/g, '_').toUpperCase();
}

function findGameComponent(gameDir: string): { fileBase: string; component: string; isDefault: boolean } {
  const entries = readdirSync(gameDir);
  const tsxFiles = entries.filter((name) => name.endsWith('.tsx'));
  if (tsxFiles.length === 0) {
    throw new Error(`No .tsx files found in ${gameDir}`);
  }

  const preferred = tsxFiles.find((name) => /Game\.tsx$/.test(name)) || tsxFiles[0];
  const fileBase = path.basename(preferred, '.tsx');
  const contents = readFileSync(path.join(gameDir, preferred), 'utf8');
  const isDefault = /export\s+default/.test(contents);

  if (isDefault) {
    return { fileBase, component: fileBase, isDefault };
  }

  const namedMatch = contents.match(/export\s+(?:function|const)\s+([A-Za-z0-9_]+)/);
  const component = namedMatch ? namedMatch[1] : fileBase;
  return { fileBase, component, isDefault };
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

function normalizeBuildScripts(frontendDir: string) {
  const packagePath = path.join(frontendDir, 'package.json');
  if (!existsSync(packagePath)) return;

  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  if (!pkg.scripts) {
    pkg.scripts = {};
  }

  // Published frontends should always build into local dist/ with no docs base path.
  pkg.scripts.build = 'tsc -b && vite build';
  if (pkg.scripts['build:docs']) {
    delete pkg.scripts['build:docs'];
  }

  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const gameSlug = args[0];
const outIndex = args.indexOf('--out');
const sourceIndex = args.indexOf('--source');
const shouldBuild = args.includes('--build');
const force = args.includes('--force');

if (outIndex >= 0 && !args[outIndex + 1]) {
  console.error('\n❌ Missing value for --out');
  usage();
  process.exit(1);
}

if (sourceIndex >= 0 && !args[sourceIndex + 1]) {
  console.error('\n❌ Missing value for --source');
  usage();
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const defaultSource = path.join(repoRoot, `${gameSlug}-frontend`);
const sourceDir = sourceIndex >= 0
  ? path.resolve(process.cwd(), args[sourceIndex + 1])
  : defaultSource;
const gameDir = path.join(sourceDir, 'src', 'games', gameSlug);

if (!existsSync(gameDir)) {
  const knownFrontends = existsSync(repoRoot)
    ? readdirSync(repoRoot).filter((name) => name.endsWith('-frontend'))
    : [];
  console.error(`\n❌ Game not found: ${gameSlug}`);
  console.error(`Expected to find ${gameDir}`);
  if (knownFrontends.length) {
    console.error(`Available frontends: ${knownFrontends.join(', ')}`);
  }
  process.exit(1);
}

const outputDir = outIndex >= 0
  ? path.resolve(process.cwd(), args[outIndex + 1])
  : path.join(repoRoot, 'dist', `${gameSlug}-frontend`);

if (existsSync(outputDir)) {
  if (!force) {
    console.error(`\n❌ Output directory already exists: ${outputDir}`);
    console.error('Use --force to overwrite or remove it first.');
    process.exit(1);
  }
  rmSync(outputDir, { recursive: true, force: true });
}

console.log(`\n📦 Publishing ${gameSlug}...`);
copyDir(sourceDir, outputDir);
normalizeBuildScripts(outputDir);

const { fileBase, component: componentName, isDefault } = findGameComponent(gameDir);
const title = titleCaseFromSlug(gameSlug);
const envKey = toEnvKey(gameSlug);

const importLine = isDefault
  ? `import ${componentName} from './games/${gameSlug}/${fileBase}';`
  : `import { ${componentName} } from './games/${gameSlug}/${fileBase}';`;

const appTemplate = `import { config } from './config';
import { LayoutStandalone } from './components/LayoutStandalone';
import { useWallet } from './hooks/useWallet';
${importLine}

const GAME_ID = '${gameSlug}';
const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || '${title}';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'On-chain game on Stellar';

export default function App() {
  const { publicKey, isConnected, isConnecting, error, connect, isWalletAvailable } = useWallet();
  const userAddress = publicKey ?? '';
  const contractId = config.contractIds[GAME_ID] || '';
  const hasContract = contractId && contractId !== 'YOUR_CONTRACT_ID';

  return (
    <LayoutStandalone title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      {!hasContract ? (
        <div className="card">
          <h3 className="gradient-text">Contract Not Configured</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '1rem' }}>
            Set the contract ID in <code>public/game-studio-config.js</code> (recommended) or in
            <code>VITE_${envKey}_CONTRACT_ID</code>.
          </p>
        </div>
      ) : !isConnected ? (
        <div className="card">
          <h3 className="gradient-text">Connect Wallet</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
            Connect your wallet to start playing.
          </p>
          {error && <div className="notice error" style={{ marginTop: '1rem' }}>{error}</div>}
          <div style={{ marginTop: '1.25rem' }}>
            <button
              onClick={() => connect().catch(() => undefined)}
              disabled={!isWalletAvailable || isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>
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
    </LayoutStandalone>
  );
}
`;

writeFileSync(path.join(outputDir, 'src', 'App.tsx'), appTemplate);

// Ensure game uses standalone wallet hook
const walletShim = `export { useWalletStandalone as useWallet } from './useWalletStandalone';\n`;
writeFileSync(path.join(outputDir, 'src', 'hooks', 'useWallet.ts'), walletShim);

// Update Vite envDir to local .env
const vitePath = path.join(outputDir, 'vite.config.ts');
if (existsSync(vitePath)) {
  const viteText = readFileSync(vitePath, 'utf8');
  const updated = viteText.replace(/envDir:\s*['\"]\.\.['\"]/g, "envDir: '.'");
  writeFileSync(vitePath, updated);
}

// Inject runtime config script
const indexPath = path.join(outputDir, 'index.html');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  let updatedHtml = html;
  const scriptTag = '  <script src="/game-studio-config.js"></script>\n';
  if (!updatedHtml.includes('game-studio-config.js')) {
    updatedHtml = updatedHtml.replace(
      /\n\s*<script type="module" src="\/src\/main\.tsx"><\/script>/,
      `\n${scriptTag}    <script type="module" src="/src/main.tsx"></script>`
    );
  }

  if (updatedHtml.includes('<title>')) {
    updatedHtml = updatedHtml.replace(/<title>.*<\/title>/, `<title>${title}</title>`);
  }

  if (updatedHtml !== html) {
    writeFileSync(indexPath, updatedHtml);
  }
}

// Create runtime config file for easy updates post-deploy
const env = await readEnvFile(path.join(repoRoot, '.env'));
const fallbackRpc = 'https://soroban-mainnet.stellar.org';
const fallbackPassphrase = 'Public Global Stellar Network ; September 2015';
const rpcUrl = env.VITE_SOROBAN_RPC_URL || fallbackRpc;
const networkPassphrase = env.VITE_NETWORK_PASSPHRASE || fallbackPassphrase;
const contractId = env[`VITE_${envKey}_CONTRACT_ID`] || '';

const runtimeConfig = {
  rpcUrl,
  networkPassphrase,
  contractIds: {
    [gameSlug]: contractId,
  },
  simulationSourceAddress: env.VITE_SIMULATION_SOURCE_ADDRESS || '',
};

const configText = `window.__STELLAR_GAME_STUDIO_CONFIG__ = ${JSON.stringify(runtimeConfig, null, 2)};\n`;

// Ensure public folder exists before writing runtime config
const publicDir = path.join(outputDir, 'public');
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}
writeFileSync(path.join(publicDir, 'game-studio-config.js'), configText);

if (shouldBuild) {
  const nodeModulesPath = path.join(outputDir, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    console.log('\n📦 Installing frontend dependencies...');
    await $`bun install`.cwd(outputDir);
  }

  console.log('\n🏗️  Building production frontend...');
  await $`bun run build`.cwd(outputDir);

  // Make the publish root directly serveable (e.g. `http-server .`) by
  // promoting built artifacts from dist/ to the output root.
  const distDir = path.join(outputDir, 'dist');
  if (existsSync(distDir)) {
    copyDir(distDir, outputDir);
  }
}

console.log(`✅ Standalone frontend created at ${outputDir}`);
if (shouldBuild) {
  console.log(`✅ Production build ready at ${outputDir}`);
  console.log(`   (dist files are also available at ${path.join(outputDir, 'dist')})`);
}
console.log('Next steps:');
console.log(`  1) cd ${outputDir}`);
if (shouldBuild) {
  console.log('  2) Update game-studio-config.js with your mainnet contract ID');
} else {
  console.log('  2) Update public/game-studio-config.js with your mainnet contract ID');
}
if (!shouldBuild) {
  console.log('  3) bun install');
  console.log('  4) bun run build');
}
