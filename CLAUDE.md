# AGENTS.md — ZK Rock Paper Scissors (Stellar + Noir + bb.js)

This game is being built using the Stellar Game Studio. I have created a game called zkrps using:
bun run create zkrps

The frontend is in zkrps-frontend/

The contracts are in contracts/zkrps

The game is designed to be built **incrementally by AI agents (Codex)**.  
Follow the task order strictly. Each task depends on the previous one being complete.

The **authoritative product definition** lives in **`./spec.md`**.  
If anything in prompts conflicts with this file, **spec.md wins**.

---

## 1. Project Goal

Build a **2-player Rock / Paper / Scissors game** where:

- Players commit to a move without revealing it.
- Moves are later revealed using **zero-knowledge proofs (Noir + Ultrahonk)**.
- Proofs are generated **in the browser** using **bb.js**.
- Proofs are verified **on-chain** by a **Soroban smart contract**.
- A shared **GameHub contract** is used to start and end games.
- There is **no backend**.

This is a **demonstration of Stellar x Noir integration**, not a production gambling app.

---

## 2. Source of Truth

- 📄 **Specification:** `./spec.md`
- 🧠 **Implementation tasks:** `./01.md` → `./05.md`

Before writing code, **read spec.md fully**.

---

## 3. Task Order (MANDATORY)

Run tasks in this order only:

1. `01.md` — Soroban session lifecycle (mock reveal, no ZK)
2. `02.md` — Noir circuit + bb.js artifacts
3. `03.md` — Ultrahonk verifier integration (real proof verification)
4. `04.md` — Frontend MVP (browser proving + RPC)
5. `05.md` — Hardening, E2E automation, documentation

❗ **Do not skip ahead.**  
❗ **Do not mix tasks.**  
❗ **Do not refactor earlier tasks unless required by spec.md.**

---

## 4. Coding Rules (Critical)

### 4.1 General
- Prefer **clarity over cleverness**
- Avoid premature optimisation
- Keep all logic **deterministic**
- Never assume a trusted backend exists

### 4.2 Soroban (Rust)
- Use **Soroban SDK v25.x**
- Avoid `unwrap()` in contract logic
- Explicitly validate:
  - auth
  - deadlines
  - session state transitions
- Emit events for all state changes
- Store minimal data; compute outcomes deterministically

### 4.3 Noir
- Circuits must:
  - enforce `move ∈ {0,1,2}`
  - bind move to commitment
- Public outputs order MUST match spec.md exactly
- Document all field encodings
- Prefer Poseidon hash compatible with Barretenberg

### 4.4 Frontend
- Proof generation **must happen in the browser**
- Never send plaintext move or salt to the chain
- Store salt locally and warn user about losing it
- Use Soroban RPC directly (no proxy server)
- Handle failures gracefully (timeouts, missing salt, proof errors)

---

## 5. ZK Integration Rules (Very Important)

- Commitment formula in frontend **must match circuit exactly**
- Public inputs encoding must match:
  - Noir output
  - bb.js serialization
  - Soroban verifier expectations
- If verifier input format mismatches:
  - Write a **Soroban adapter contract**
  - Do NOT “fix” by altering circuit logic silently

---

## 6. Testing Expectations

### Required at Each Stage

- **Task 01**
  - `cargo test` passes
  - winner logic validated for all cases
  - deadline / forfeit paths tested

- **Task 02**
  - Circuit compiles
  - Proof verifies off-chain
  - Public outputs sanity-checked

- **Task 03**
  - Contract verifies real proofs OR
  - Mock verifier used with clear TODO marker
  - At least one integration path exists

- **Task 04**
  - Two real wallets can complete a full game on testnet
  - Proofs generated client-side only

- **Task 05**
  - One-command E2E demo works
  - Docs sufficient for a new developer to reproduce

---

## 7. Allowed Assumptions

- Testnet only
- Wallet funding via Friendbot is acceptable
- GameHub contract already exists and works as documented
- Ultrahonk verifier contract may be vendored or adapted

---

## 8. Disallowed Shortcuts

❌ No backend “for now”  
❌ No plaintext reveal fallback in final build  
❌ No skipping deadlines/forfeits  
❌ No hardcoded moves or commitments  
❌ No trusting frontend without cryptographic verification  

---

## 9. Style & Documentation

- Every module should have a short README
- Public functions should have doc comments
- Explain *why* something exists, not just *what*
- Leave clear TODOs where future work is expected

---

## 10. Completion Definition

This project is complete when:

- A user can open the frontend
- Two players commit privately
- Both generate ZK proofs in-browser
- Soroban verifies proofs on-chain
- GameHub is called to finalise the game
- The winner is correct and deterministic

If any part fails, **debug the integration before adding features**.

---

## 11. When in Doubt

1. Re-read `spec.md`
2. Prefer explicit validation over assumptions
3. Choose determinism over UX convenience
4. Ask: *“Can the chain verify this without trusting the UI?”*

That question should guide every decision.

-------------

This repo is the Stellar Game Studio. Use this guide when building or updating games so AI tools can navigate the repo and follow the expected Soroban + frontend patterns.

**Repo Map**
- `contracts/` Soroban game contracts + `mock-game-hub`
- `contracts/number-guess/`, `contracts/twenty-one/`, `contracts/dice-duel/` reference implementations
- `bindings/` generated TypeScript bindings (do not hand-edit)
- `scripts/` Bun scripts for create/build/deploy/bindings/dev flows
- `template_frontend/` standalone number-guess example frontend used by the create script
- `<game>-frontend/` standalone game frontends generated by the create script
- `sgs_frontend/` studio catalog frontend and docs source
- `docs/` built documentation output
- `deployment.json` deployment metadata

**Golden Rules**
- Every game must call Game Hub `start_game` and `end_game`.
- Keep randomness deterministic between simulation and submission. Do not use ledger time or sequence.
- Prefer temporary storage with a 30-day TTL for game state and extend TTL on every state write.
- Game Hub is the single source of truth for lifecycle events. Avoid duplicate start/end events in games.
- Exactly two players per session. Reject self-play where appropriate.

**Create Flow**
1. `bun run create <game-name>`
2. Review `contracts/<game-name>/Cargo.toml` and package name.
3. Implement contract logic in `contracts/<game-name>/src/lib.rs` using the number-guess pattern.
4. Build, deploy, generate bindings, and wire the frontend config.

**Contract Checklist (Soroban)**
1. Implement the required Game Hub client interface:
```rust
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

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}
```
2. Implement `__constructor(env, admin, game_hub)` and store `Admin` + `GameHubAddress` in instance storage.
3. In `start_game`, call `player1.require_auth_for_args(...)` and `player2.require_auth_for_args(...)` for points.
4. Call `game_hub.start_game(&env.current_contract_address(), ...)` before storing the game.
5. Store game state in temporary storage and `extend_ttl` to 30 days on every write.
6. In the game-end path, call `game_hub.end_game(...)` before finalizing the winner state.
7. Use `Error` enums for game errors and keep `get_game` available for UI state reads.

**Deterministic Randomness**
- Use `env.prng()` with a seed derived from inputs like `session_id`, player addresses, or committed data.
- Example pattern in `contracts/dice-duel/src/lib.rs` uses `env.crypto().keccak256` to derive seeds.
- Never use ledger time or sequence for randomness.

**Testing**
- Add unit tests in `contracts/<game-name>/src/test.rs`.
- Use the mock Game Hub pattern from `contracts/number-guess/src/test.rs` or `contracts/mock-game-hub`.
- Tests should cover start, play progression, and end-game reporting.

**Bindings**
- Build and generate bindings via scripts when interfaces change:
```bash
bun run build <game-name>
bun run bindings <game-name>
```
- Copy generated `bindings/<game_name>/src/index.ts` into the game frontend `bindings.ts`.
- Do not edit generated bindings by hand.

**Frontend Checklist (Standalone)**
1. Update UI + service files in `<game-name>-frontend/src/games/<game-name>/`.
2. Replace `<game-name>-frontend/src/games/<game-name>/bindings.ts` with generated bindings.
3. Set the contract ID in `<game-name>-frontend/public/game-studio-config.js`.
4. Run `bun run dev:game <game-name>` or `cd <game-name>-frontend && bun run dev`.

**Frontend Checklist (Studio Catalog, Optional)**
1. Copy the module: `cp -r <game-name>-frontend/src/games/<game-name> sgs_frontend/src/games/`.
2. Add a game card entry in `sgs_frontend/src/components/GamesCatalog.tsx`.
3. Add any constants in `sgs_frontend/src/utils/constants.ts`.
4. Add backwards-compatible aliases in `sgs_frontend/src/config.ts` if needed.
5. Use the `number-guess` service pattern for multi-sig creation.

**Common Commands**
```bash
bun run setup                         # Build + deploy testnet contracts, generate bindings, write .env
bun run create <game-name>            # Scaffold contract + standalone frontend
bun run build [contract-name...]      # Build all or selected contracts
bun run deploy [contract-name...]     # Deploy all or selected contracts to testnet
bun run bindings [contract-name...]   # Generate bindings for all or selected contracts
bun run dev:game <game-name>          # Run a standalone frontend with dev wallet switching
bun run publish <game-name> --build   # Export + build production frontend
```

**Final QA Checklist**
- Contract builds successfully.
- `start_game` and `end_game` are called in the correct order.
- Game state uses temporary storage with a 30-day TTL.
- Bindings regenerated after contract changes.
- Standalone frontend uses the correct contract ID.
- Studio catalog entry appears if imported.
- Both players can complete a full game flow.

## RPS Game Commands
- Build contract: `stellar contract build --manifest-path contracts/rps_game/Cargo.toml`
- Run tests: `cargo test -p rps_game`
- Produce wasm: `stellar contract build --manifest-path contracts/rps_game/Cargo.toml`
Output: `target/wasm32v1-none/release/rps_game.wasm`
