import { useState } from 'react';
import {
  ExternalLink,
  Rocket,
  Sparkles,
  Download,
  UploadCloud,
  Terminal,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import './Resources.css';

export type DocSection = 'quickstart' | 'create' | 'import' | 'publish';

interface ResourcesProps {
  onBack?: () => void;
}

export function Resources({ onBack }: ResourcesProps) {
  const [activeSection, setActiveSection] = useState<DocSection>('quickstart');

  const handleNavClick = (section: DocSection) => {
    setActiveSection(section);
  };

  const handleExternalLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="resources-page">
      <aside className="resources-sidebar">
        <div className="sidebar-content">
          {onBack && (
            <button className="nav-item back" onClick={onBack}>
              Back to Studio
            </button>
          )}

          <h3 className="sidebar-title">Documentation</h3>

          <nav className="sidebar-nav">
            <button
              className={`nav-item ${activeSection === 'quickstart' ? 'active' : ''}`}
              onClick={() => handleNavClick('quickstart')}
            >
              <span className="nav-icon" aria-hidden="true">
                <Rocket size={16} />
              </span>
              Quickstart
            </button>

            <button
              className={`nav-item ${activeSection === 'create' ? 'active' : ''}`}
              onClick={() => handleNavClick('create')}
            >
              <span className="nav-icon" aria-hidden="true">
                <Sparkles size={16} />
              </span>
              Create a Game
            </button>

            <button
              className={`nav-item ${activeSection === 'import' ? 'active' : ''}`}
              onClick={() => handleNavClick('import')}
            >
              <span className="nav-icon" aria-hidden="true">
                <Download size={16} />
              </span>
              Import a Game
            </button>

            <button
              className={`nav-item ${activeSection === 'publish' ? 'active' : ''}`}
              onClick={() => handleNavClick('publish')}
            >
              <span className="nav-icon" aria-hidden="true">
                <UploadCloud size={16} />
              </span>
              Publish a Game
            </button>
          </nav>

          <div className="sidebar-divider" />

          <h3 className="sidebar-title">External Links</h3>

          <nav className="sidebar-nav">
            <button
              className="nav-item external"
              onClick={() => handleExternalLink('https://developers.stellar.org/')}
            >
              <span className="nav-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
              <span className="nav-label">Developer Docs</span>
              <span className="external-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
            </button>

            <button
              className="nav-item external"
              onClick={() => handleExternalLink('https://docs.rs/soroban-sdk/latest/soroban_sdk/')}
            >
              <span className="nav-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
              <span className="nav-label">Soroban SDK</span>
              <span className="external-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
            </button>

            <button
              className="nav-item external"
              onClick={() => handleExternalLink('https://developers.stellar.org/docs/tools/developer-tools')}
            >
              <span className="nav-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
              <span className="nav-label">Developer Tools</span>
              <span className="external-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
            </button>

            <button
              className="nav-item external"
              onClick={() => handleExternalLink('https://soropg.com')}
            >
              <span className="nav-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
              <span className="nav-label">Soroban Playground</span>
              <span className="external-icon" aria-hidden="true">
                <ExternalLink size={16} />
              </span>
            </button>
          </nav>
        </div>
      </aside>

      <main className="resources-content">
        <DocumentationContent section={activeSection} />
      </main>
    </div>
  );
}

export function DocumentationContent({ section }: { section: DocSection }) {
  if (section === 'quickstart') return <QuickstartSection />;
  if (section === 'create') return <CreateGameSection />;
  if (section === 'import') return <ImportGameSection />;
  return <PublishGameSection />;
}

function QuickstartSection() {
  return (
    <div className="doc-section" id="quickstart">
      <h1 className="doc-title">Quickstart</h1>
      <p className="doc-subtitle">
        Fork the repo, deploy contracts to testnet, and start building in a two-player sandbox.
      </p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Prerequisites</h2>
          <p>Install the toolchain below before you begin.</p>
          <ul>
            <li>
              <strong>Bun</strong> (v1.0+)
            </li>
            <li>
              <strong>Rust & Cargo</strong> (v1.84+)
            </li>
            <li>
              <strong>Stellar CLI</strong> (v21.0+)
            </li>
            <li>
              <strong>wasm32v1-none target</strong>
            </li>
          </ul>
          <div className="code-block">
            <pre>
              <code>{`curl -fsSL https://bun.sh/install | bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --locked stellar-cli --features opt
rustup target add wasm32v1-none`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Fork + clone</h2>
          <p>Start by forking the repository and cloning your fork locally.</p>
          <div className="code-block">
            <pre>
              <code>{`git clone https://github.com/jamesbachini/Stellar-Game-Studio
cd Stellar-Game-Studio
bun install`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>One-command setup</h2>
          <p>Build contracts, deploy to testnet, and generate bindings.</p>
          <div className="code-block">
            <pre>
              <code>{`bun run setup`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">
              <Terminal size={18} />
            </div>
            <div>
              <strong>What happens during setup?</strong>
              <ol>
                <li>Builds all Soroban contracts</li>
                <li>Deploys contracts to Stellar testnet</li>
                <li>Generates TypeScript bindings</li>
                <li>Creates or reuses admin + player testnet wallets (funded via friendbot)</li>
                <li>Writes contract IDs + dev wallet secrets to the root <code>.env</code></li>
              </ol>
            </div>
          </div>
        </section>

        <section className="content-block">
          <h2>Start a game frontend</h2>
          <p>Create a game and launch the dev wallet sandbox.</p>
          <div className="code-block">
            <pre>
              <code>{`bun run create my-game
bun run dev:game my-game`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">
              <Wallet size={18} />
            </div>
            <div>
              <strong>Dev wallet switching</strong>
              <p>
                The dev frontend auto-connects Player 1 and lets you switch to Player 2 instantly,
                using the same wallet switcher as the original studio.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CreateGameSection() {
  return (
    <div className="doc-section" id="create">
      <h1 className="doc-title">Create a New Game</h1>
      <p className="doc-subtitle">
        Scaffold a Soroban contract and a standalone frontend that integrates with Game Hub.
      </p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Overview</h2>
          <p>
            The create script produces a Soroban contract and a standalone frontend in
            <code>&lt;game&gt;-frontend/</code>. You can host the frontend anywhere once you are ready to
            publish.
          </p>
        </section>

        <section className="content-block">
          <h2>Files you will modify</h2>
          <ul>
            <li>
              <code>contracts/&lt;game-name&gt;/</code> - New contract source
            </li>
            <li>
              <code>&lt;game-name&gt;-frontend/src/games/&lt;game-name&gt;/</code> - Game UI + service files
            </li>
            <li>
              <code>&lt;game-name&gt;-frontend/src/App.tsx</code> - Dev entry point
            </li>
          </ul>
        </section>

        <section className="content-block">
          <h2>Step 1: Run the create script</h2>
          <div className="code-block">
            <pre>
              <code>{`bun run create my-game`}</code>
            </pre>
          </div>
          <p>If <code>my-game-frontend/</code> already exists, add <code>--force</code> to overwrite it.</p>
        </section>

        <section className="content-block">
          <h2>Step 2: Implement Game Hub integration</h2>
          <p>
            Your contract must call <code>start_game</code> and <code>end_game</code> on the Game Hub contract.
            Use the client interface below.
          </p>
          <p>
            For testnet, <code>bun run deploy</code> will reuse the shared mock Game Hub contract
            (<code>CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG</code>) when it exists,
            or deploy a new mock if that contract is unavailable.
          </p>
          <div className="code-block">
            <pre>
              <code>{`#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}`}</code>
            </pre>
          </div>
          <div className="info-box">
            <div className="info-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <strong>Two-player constraint</strong>
              <p>
                Game Hub enforces two-player sessions. Require auth for both players when starting
                the game.
              </p>
            </div>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 3: Build, deploy, and generate bindings</h2>
          <p>Once your contract is listed in the workspace, the scripts handle the rest.</p>
          <div className="code-block">
            <pre>
              <code>{`bun run setup
# or
bun run build my-game
bun run deploy my-game
bun run bindings my-game`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 4: Run the dev frontend</h2>
          <div className="code-block">
            <pre>
              <code>{`bun run dev:game my-game`}</code>
            </pre>
          </div>
          <p>
            The dev frontend uses testnet wallets with a built-in player switcher so you can test
            two-player flows quickly.
          </p>
        </section>

        <section className="content-block">
          <h2>Step 5: Update bindings in the frontend</h2>
          <p>After regenerating bindings, copy them into your frontend module.</p>
          <div className="code-block">
            <pre>
              <code>{`bun run bindings my-game
cp bindings/my_game/src/index.ts my-game-frontend/src/games/my-game/bindings.ts`}</code>
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}

function ImportGameSection() {
  return (
    <div className="doc-section" id="import">
      <h1 className="doc-title">Import a Game</h1>
      <p className="doc-subtitle">
        Bring an existing Soroban game into the workflow with minimal wiring.
      </p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Step 1: Add contract files</h2>
          <div className="code-block">
            <pre>
              <code>{`cp -r /path/to/game-contract contracts/imported-game`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 2: Add to the workspace</h2>
          <div className="code-block">
            <pre>
              <code>{`[workspace]
members = [
  "contracts/mock-game-hub",
  "contracts/twenty-one",
  "contracts/number-guess",
  "contracts/imported-game",
]`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 3: Scaffold a frontend shell</h2>
          <div className="code-block">
            <pre>
              <code>{`bun run create imported-game`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 4: Copy in your UI + bindings</h2>
          <p>Drop your UI module into the generated frontend and update bindings.</p>
          <div className="code-block">
            <pre>
              <code>{`cp -r /path/to/game-ui imported-game-frontend/src/games/imported-game
bun run bindings imported-game
cp bindings/imported_game/src/index.ts imported-game-frontend/src/games/imported-game/bindings.ts`}</code>
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}

function PublishGameSection() {
  return (
    <div className="doc-section" id="publish">
      <h1 className="doc-title">Publish a Game</h1>
      <p className="doc-subtitle">Deploy on mainnet and ship a production-ready frontend.</p>

      <div className="doc-content">
        <section className="content-block">
          <h2>Step 1: Deploy your contract to mainnet</h2>
          <div className="code-block">
            <pre>
              <code>{`bun run build my-game
stellar contract install --wasm target/wasm32v1-none/release/my_game.wasm --source-account <ADMIN_SECRET> --network mainnet
stellar contract deploy --wasm-hash <WASM_HASH> --source-account <ADMIN_SECRET> --network mainnet -- \\
  --admin <ADMIN_ADDRESS> --game-hub <GAME_HUB_MAINNET_CONTRACT_ID>`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 2: Register your game with Game Hub</h2>
          <p>
            The mainnet Game Hub only accepts outcomes from approved games. The admin must call
            <code>add_game</code> with your contract ID and developer address.
          </p>
          <div className="code-block">
            <pre>
              <code>{`stellar contract invoke --id <GAME_HUB_MAINNET_CONTRACT_ID> --source-account <GAME_HUB_ADMIN_SECRET> --network mainnet -- \\
  add_game --game_id <YOUR_GAME_CONTRACT_ID> --developer <YOUR_DEVELOPER_ADDRESS>`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 3: Build the production frontend</h2>
          <p>
            The publish script creates a standalone frontend, injects a runtime config, and swaps in
            the standalone wallet hook.
          </p>
          <div className="code-block">
            <pre>
              <code>{`bun run publish my-game --build
# Optional: choose a custom output directory
bun run publish my-game --out ../my-game-frontend --build`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 4: Configure runtime settings</h2>
          <p>
            Update <code>public/game-studio-config.js</code> in the published output with mainnet values.
          </p>
          <div className="code-block">
            <pre>
              <code>{`window.__STELLAR_GAME_STUDIO_CONFIG__ = {
  rpcUrl: "https://soroban-mainnet.stellar.org",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  contractIds: {
    "my-game": "<YOUR_MAINNET_CONTRACT_ID>"
  },
  simulationSourceAddress: "<OPTIONAL_FUNDED_ADDRESS>"
};`}</code>
            </pre>
          </div>
        </section>

        <section className="content-block">
          <h2>Step 5: Deploy the frontend</h2>
          <p>
            If you used <code>--build</code>, the static files are in
            <code>dist/&lt;game&gt;-frontend/dist</code>. Deploy the output to any static host.
          </p>
          <div className="code-block">
            <pre>
              <code>{`# Vercel
vercel --prod

# Cloudflare Pages
wrangler pages deploy dist`}</code>
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
