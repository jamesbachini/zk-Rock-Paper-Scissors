# Not working due to issues with TX limits

## Do not use/fork

Development Tools For Web3 Game Builders On Stellar.

Ecosystem ready game templates and examples ready to scaffold into into your development workflow

**Start here:** [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/)

## ZK RPS Demo (This Repo)

This repository includes a full ZK Rock/Paper/Scissors demo (`contracts/rps_game`, `contracts/verifier`, `circuits/rps_commit`, `zkrps-frontend`). The flow is commit → prove/reveal (Ultrahonk via bb.js) → finalize via GameHub.

### Prerequisites

- Bun (for scripts and frontends)
- Node.js 18+ (for `scripts/e2e.mjs`)
- Rust toolchain + Stellar CLI (`stellar`)
- Noir tooling (`nargo`)
- Access to Stellar testnet (Friendbot for funding)

### Build Steps

1. **Circuit**
```bash
cd circuits/rps_commit
bun install
bun run compile
bun run artifacts
```

2. **Contracts**
```bash
stellar contract build --manifest-path contracts/verifier/Cargo.toml
stellar contract build --manifest-path contracts/rps_game/Cargo.toml
```

3. **Bindings**
```bash
stellar contract bindings typescript \
  --wasm target/wasm32v1-none/release/rps_game.wasm \
  --output-dir bindings/rps_game \
  --overwrite

cp bindings/rps_game/src/index.ts zkrps-frontend/src/games/zkrps/bindings.ts
```

4. **Frontend**
```bash
cd zkrps-frontend
bun install
bun run dev
```

### Deploy to Testnet

1. **Deploy verifier (requires VK)**
```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/ultrahonk_soroban_contract.wasm \
  --source <ADMIN_SECRET> \
  --network testnet \
  -- \
  --vk_bytes-file-path circuits/rps_commit/artifacts/vk.bin
```

2. **Deploy game**
```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rps_game.wasm \
  --source <ADMIN_SECRET> \
  --network testnet
```

3. **Initialize game**
```bash
stellar contract invoke \
  --id <RPS_CONTRACT_ID> \
  --source-account <ADMIN_SECRET> \
  --network testnet \
  -- init \
  --game_hub <GAME_HUB_CONTRACT_ID> \
  --verifier <VERIFIER_CONTRACT_ID> \
  --commit_window 100 \
  --reveal_window 100
```

### Demo Walkthrough

1. **One-command E2E**
```bash
bun run e2e
```

The E2E script reads credentials from `.env` (`VITE_DEV_PLAYER1_SECRET`, `VITE_DEV_PLAYER2_SECRET`) or
override with `E2E_PLAYER1_SECRET`, `E2E_PLAYER2_SECRET`, and `E2E_ADMIN_SECRET`.
Use `bun run e2e -- --deploy` to force redeploy of verifier + game contracts.
If testnet rejects proof verification due to budget limits, run against a local Soroban network with higher limits.
You can use the Stellar CLI container:
`stellar container start local`
Then fetch the passphrase (once the container is running):
`stellar network info -n local --output json-formatted`
Then run E2E against local:
`E2E_NETWORK=local E2E_RPC_URL=http://localhost:8000/soroban/rpc E2E_NETWORK_PASSPHRASE="<passphrase>" bun run e2e -- --deploy`

2. **Manual**
- Open the frontend (`zkrps-frontend`).
- Player 1 creates a session and shares the signed auth entry with Player 2.
- Both players commit moves (salt stored locally).
- Both players reveal with proofs (browser-generated).
- Finalize to see the winner.

### Known Issues + Troubleshooting

- **Proof verification failed:** ensure bb.js uses `{ keccak: true }` (the on-chain verifier uses Keccak for Fiat–Shamir).
- **Budget exceeded on testnet:** Ultrahonk verification can exceed current testnet limits. Use a local RPC with higher limits.
- **Public inputs mismatch:** must be 64 bytes, two 32-byte big-endian field elements in order `[commitment, move_public]`.
- **Commitment mismatch:** commitment must be `Poseidon2Hash(Poseidon2Hash(session_id, move), salt)`.
- **Missing salt:** reveal cannot be generated if localStorage was cleared.
- **Deadline errors:** commit/reveal windows are ledger-based; if deadlines pass, only `finalize` is allowed.
- **Verifier deploy requires `vk.bin`:** the generic `bun run deploy` flow does not inject VK; use the manual deploy command above or the E2E script.


## Why this exists

Stellar Game Studio is a toolkit for shipping web3 games quickly and efficiently. It pairs Stellar smart contract patterns with a ready-made frontend stack and deployment scripts, so you can focus on game design and gameplay mechanics.

## What you get

- Battle-tested Soroban patterns for two-player games
- A ecosystem ready mock game hub contract that standardizes lifecycle and scoring
- Deterministic randomness guidance and reference implementations
- One-command scaffolding for contracts + standalone frontend
- Testnet setup that generates wallets, deploys contracts, and wires bindings
- A production build flow that outputs a deployable frontend

## Quick Start (Dev)

```bash
# Fork the repo, then:
git clone https://github.com/jamesbachini/Stellar-Game-Studio
cd Stellar-Game-Studio
bun install

# Build + deploy contracts to testnet, generate bindings, write .env
bun run setup

# Scaffold a game + dev frontend
bun run create my-game

# Run the standalone dev frontend with testnet wallet switching
bun run dev:game my-game
```

## Publish (Production)

```bash
# Export a production container and build it (uses CreitTech wallet kit v2)
bun run publish my-game --build

# Update runtime config in the output
# dist/my-game-frontend/public/game-studio-config.js
```

## Project Structure

```
├── contracts/               # Soroban contracts for games + mock Game Hub
├── template_frontend/       # Standalone number-guess example frontend used by create
├── <game>-frontend/         # Standalone game frontend (generated by create)
├── sgs_frontend/            # Documentation site (builds to docs/)
├── scripts/                 # Build & deployment automation
└── bindings/                # Generated TypeScript bindings
```

## Commands

```bash
bun run setup                         # Build + deploy testnet contracts, generate bindings
bun run build [game-name]             # Build all or selected contracts
bun run deploy [game-name]            # Deploy all or selected contracts to testnet
bun run bindings [game-name]          # Generate bindings for all or selected contracts
bun run create my-game                # Scaffold contract + standalone frontend
bun run dev:game my-game              # Run a standalone frontend with dev wallet switching
bun run publish my-game --build       # Export + build production frontend
```

## Ecosystem Constraints

- Every game must call `start_game` and `end_game` on the Game Hub contract:
  Testnet: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
- Game Hub enforces exactly two players per session.
- Keep randomness deterministic between simulation and submission.
- Prefer temporary storage with a 30-day TTL for game state.

## Notes

- Dev wallets are generated during `bun run setup` and stored in the root `.env`.
- Production builds read runtime config from `public/game-studio-config.js`.

Interface for game hub:
```
#[contractclient(name = "GameHubClient")]
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

    fn end_game(
      env: Env,
      session_id: u32,
      player1_won: bool
    );
}
```

## Studio Reference

Run the studio frontend locally (from `sgs_frontend/`):
```bash
bun run dev
```

Build docs into `docs/`:
```bash
bun --cwd=sgs_frontend run build:docs
```

## Links
https://developers.stellar.org/
https://risczero.com/
https://jamesbachini.com
https://www.youtube.com/c/JamesBachini
https://bachini.substack.com
https://x.com/james_bachini
https://www.linkedin.com/in/james-bachini/
https://github.com/jamesbachini

## 📄 License

MIT License - see LICENSE file


**Built with ❤️ for Stellar developers**
