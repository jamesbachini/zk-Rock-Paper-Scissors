# spec.md — ZK Rock Paper Scissors on Stellar (Soroban + Noir + bb.js Ultrahonk)

## 1. Overview

Build a 2-player **Rock / Paper / Scissors** game where each player:
1) **Commits** to a move (Rock/Paper/Scissors) without revealing it.
2) Later **reveals** the move by submitting an **Ultrahonk proof generated in the browser** via **bb.js**.
3) A Soroban smart contract verifies each proof on-chain, computes the winner deterministically, and finalises the session via the **GameHub** interface.

There is **no backend**. The frontend:
- Generates commitments and proofs locally.
- Submits transactions to Soroban RPC.

Verification is performed by an on-chain Ultrahonk verifier contract (e.g. based on `indextree/ultrahonk_soroban_contract`), called by the game contract.

---

## 2. Goals

- Demonstrate **Stellar x Noir** end-to-end:
  - Noir circuits compiled to a verifier compatible with Ultrahonk.
  - Proof generation in-browser with bb.js.
  - Proof verification in Soroban and deterministic settlement.
- No trusted server, no backend.
- Simple rules, clear UX.

---

## 3. Non-Goals

- Tokens / wagering / escrow.
- Matchmaking server.
- Complex account recovery or social features.
- Perfect anti-griefing in adversarial environments (we will add timeouts and forfeits, but keep it simple).

---

## 4. High-Level Architecture

### Components
1) **Frontend (Web)**
   - Lets two players join the same session ID.
   - Generates:
     - commitment = H(move, salt)
     - Ultrahonk proof for reveal
   - Submits Soroban transactions via RPC:
     - commit_move()
     - reveal_move(proof, public_inputs)
     - finalize() / end_game path

2) **Noir Circuit**
   - Proves knowledge of:
     - `move ∈ {0,1,2}`
     - `salt` (secret)
   - Such that:
     - `commitment == Poseidon(move || salt)` (or equivalent field hashing scheme)
   - Outputs `move` as a **public output** so the contract can compute the winner.

3) **Soroban Game Contract**
   - Stores per-session commitments and reveal state.
   - Verifies Ultrahonk proofs using a verifier contract (cross-contract call).
   - Computes winner.
   - Calls `GameHubClient.start_game(...)` and `GameHubClient.end_game(...)`.

4) **GameHub Contract (provided externally)**
   - Interface used to start/end games:
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

         fn end_game(
           env: Env,
           session_id: u32,
           player1_won: bool
         );
     }
     ```

---

## 5. Game Rules

- Moves are encoded as:
  - `0 = Rock`
  - `1 = Paper`
  - `2 = Scissors`

- Winner logic:
  - Tie if same move.
  - Otherwise:
    - Rock beats Scissors
    - Scissors beats Paper
    - Paper beats Rock

- Session lifecycle:
  1) `create_session` (optional convenience) or first commit implicitly creates it.
  2) Both players **commit** before a deadline.
  3) Both players **reveal** using proofs before a reveal deadline.
  4) Anyone can **finalize** once both revealed or a timeout triggers a forfeit.

---

## 6. On-Chain Data Model (Soroban)

### 6.1 Storage Keys

Use a `session_id: u32` as primary key.

Suggested storage layout (pseudo):

- `Session(session_id) -> SessionData`
- `Commit(session_id, player_addr) -> BytesN<32>` (commitment)
- `Reveal(session_id, player_addr) -> u8` (move, once proven)
- `State(session_id) -> SessionState` (or embedded in SessionData)

### 6.2 SessionData

Fields:
- `player1: Address`
- `player2: Address`
- `created_ledger: u32` (or timestamp if available)
- `commit_deadline_ledger: u32`
- `reveal_deadline_ledger: u32`
- `commit_p1: Option<BytesN<32>>`
- `commit_p2: Option<BytesN<32>>`
- `move_p1: Option<u8>`
- `move_p2: Option<u8>`
- `finalized: bool`
- `winner: Option<i8>` where:
  - `0 = tie`
  - `1 = player1`
  - `2 = player2`

### 6.3 Timeouts / Anti-Grief

Use ledger sequence for deadlines:
- `commit_deadline_ledger = current + COMMIT_WINDOW`
- `reveal_deadline_ledger = commit_deadline_ledger + REVEAL_WINDOW`

Forfeits:
- If only one player commits by commit deadline → other forfeits, finalize possible.
- If both commit but only one reveals by reveal deadline → non-revealer forfeits, finalize possible.
- If neither reveals → tie/void; choose deterministic outcome (recommended: tie/void).

---

## 7. Soroban Contract Interface

### 7.1 Public Functions

#### `init(game_hub: Address, verifier: Address, commit_window: u32, reveal_window: u32)`
- One-time initialisation.
- Stores:
  - GameHub address
  - Ultrahonk verifier address
  - timing windows

#### `create_session(session_id: u32, player1: Address, player2: Address)`
Optional. If omitted, session can be created on first commit.
- Validates:
  - `player1 != player2`
- Stores session data and calls:
  - `GameHub.start_game(env, this_contract_address, session_id, player1, player2, 0, 0)`

#### `commit_move(session_id: u32, player: Address, commitment: BytesN<32>)`
- Auth:
  - `player.require_auth()`
- Validates:
  - Session exists OR create implicitly if first commit (if doing implicit create, must pass both players; easiest is explicit `create_session`)
  - player is player1 or player2
  - not past commit deadline
  - player hasn’t already committed
- Stores commitment.

#### `reveal_move(session_id: u32, player: Address, proof: Bytes, public_inputs: Vec<...>)`
- Auth:
  - `player.require_auth()`
- Validates:
  - player committed
  - not already revealed
  - within reveal window (or allow reveal after deadline but it may still lose to forfeit logic; simplest: enforce deadline)
- Verifies proof via verifier contract call.
- Extracts public outputs:
  - expected: `[commitment, move]` (exact ordering specified in Circuit section)
- Validates:
  - public `commitment` equals stored commitment for player
  - `move` in {0,1,2} (the circuit should enforce, but re-check anyway)
- Stores revealed move.

#### `finalize(session_id: u32)`
- Anyone can call.
- Validates:
  - not finalized
- Computes outcome:
  - If both revealed: compute winner from moves.
  - Else apply forfeit logic based on deadlines and commit/reveal status.
- Stores winner and finalized=true.
- Calls:
  - `GameHub.end_game(env, session_id, player1_won)` where:
    - `player1_won = true` if winner==1
    - `player1_won = false` if winner==2 or tie (tie treated as false)

> Note: GameHub’s signature only returns `player1_won: bool`. Tie handling must be consistent; recommended: treat tie as `false` and also emit an event with winner state.

### 7.2 Events

Emit events for frontend indexing:
- `SessionCreated { session_id, player1, player2 }`
- `MoveCommitted { session_id, player }`
- `MoveRevealed { session_id, player, move }`
- `Finalized { session_id, winner }` (winner: 0/1/2)

---

## 8. Noir Circuit Specification

### 8.1 Purpose

Prove that a player’s revealed move is bound to their earlier commitment without revealing the salt.

### 8.2 Inputs / Outputs

**Private inputs**
- `move: Field` or `u8` (encoded as 0/1/2)
- `salt: Field` (random)

**Public inputs / outputs**
- `commitment: Field` (or Bytes32 mapped into Field elements)
- `move_public: Field` (same move, exposed)

The circuit must enforce:
- `move ∈ {0,1,2}`
- `commitment == Poseidon(move, salt)` (or a stable encoding)

And expose:
- `commitment` as a public value
- `move_public` as public output

### 8.3 Hash Function

Use Poseidon compatible with bb.js / Barretenberg.
- Commit formula (recommended):
  - `commitment = poseidon2([move, salt])` or barretenberg’s poseidon variant supported in Noir.

### 8.4 Public Input Ordering

Define a strict order to match Soroban verification:

Recommended public vector:
1. `commitment`
2. `move_public`

Soroban contract will parse public outputs accordingly.

### 8.5 Proof System

- bb.js generates Ultrahonk proofs in browser.
- Contract verifies Ultrahonk proof using a deployed verifier contract.

Deliverables from Noir build:
- Compiled circuit artifacts required by bb.js (ACIR + proving key or whatever bb.js expects for browser proving).
- Verifier artifact(s) compatible with Soroban ultrahonk verifier contract integration.

---

## 9. Ultrahonk Verifier Integration (Soroban)

### 9.1 Verifier Contract

Deploy a verifier contract (or import as dependency) based on:
- `https://github.com/indextree/ultrahonk_soroban_contract`

Game contract stores `verifier: Address` and calls something like:
- `verifier.verify(proof, public_inputs) -> bool`

The exact function signature must be aligned with the verifier contract you deploy.
If needed, create a thin Soroban adapter contract that normalises inputs for verification.

### 9.2 Public Inputs Encoding

Define how public inputs are encoded for Soroban:
- If verifier expects field elements, represent as `i128` or `Bytes` depending on implementation.
- Ensure consistent endianness and field modulus representation across:
  - Noir / bb.js
  - Soroban verifier

This is the #1 integration risk; treat it as a first-class acceptance test.

---

## 10. Frontend Specification

### 10.1 Tech Stack

- Use the Stellar Game Studio interface patterns for game sessions:
  - Use `session_id` as the shared join code.
- Browser-only proving with bb.js:
  - `@aztec/bb.js` (or equivalent package)
- Soroban RPC interactions:
  - Stellar JS SDK / soroban rpc client
- Wallet:
  - Two real players can use their own wallets, OR
  - For demo: allow “local ephemeral keys” with airdrop/friendbot on testnet (optional, but no backend).

### 10.2 UX Flow

**Home**
- Create Session:
  - Choose session id (random u32 suggested)
  - Input Player2 address (or share link)
  - Deploy/create session on-chain (create_session)
- Join Session:
  - Enter session id
  - Connect wallet

**Commit Screen**
- Select move (Rock/Paper/Scissors)
- Generate random salt
- Compute commitment
- Submit `commit_move`
- Store salt locally (localStorage) under session_id + wallet address (warn user to keep it)

**Reveal Screen**
- Load stored salt
- Build proof in browser using bb.js:
  - private: move + salt
  - public: commitment + move_public
- Submit `reveal_move(proof, public_inputs)`
- Wait for opponent

**Finalise Screen**
- Once both revealed (or timeouts), call `finalize`
- Display winner

### 10.3 Frontend State

Track:
- session data from contract (poll or events)
- commitment submitted state
- reveal submitted state
- finalize state

### 10.4 Error Handling

- Missing salt (user cleared storage) → cannot prove reveal; provide guidance.
- Proof generation failures → show actionable logs.
- Deadline passed → show forfeit rules and allow finalize.

---

## 11. Testing & Acceptance Criteria

### 11.1 Unit Tests (Rust)
- Commit logic:
  - Only players can commit
  - Only once
  - Deadline enforced
- Reveal logic:
  - Requires commitment
  - Only once
  - Deadline rules
  - Reject mismatched commitment in public outputs
- Finalize logic:
  - Both reveal winner correctness for all 9 combinations
  - Forfeit conditions (commit/reveal timeouts)
  - Idempotency (finalize only once)
- GameHub calls:
  - start_game invoked exactly once
  - end_game invoked exactly once

> Proof verification can be mocked in unit tests if needed (inject a verifier address that returns true/false), but at least one integration test should verify real proof.

### 11.2 Integration Test (End-to-End)
- Compile Noir circuit, generate proof using bb.js tooling (node-based test runner is acceptable even if app is browser-only).
- Deploy verifier contract + game contract to testnet (or local sandbox if available).
- Run:
  - create_session
  - commit p1/p2
  - reveal p1/p2 with real proofs
  - finalize
- Assert final winner matches moves.

### 11.3 Acceptance Criteria
- A player cannot change their move after committing.
- Proofs generated in-browser are verified on-chain.
- The contract can compute and finalise the winner deterministically.
- No backend required for any step.

---

## 12. Security Considerations

- Commitment must be binding:
  - Use strong random salt (crypto.getRandomValues).
- Prevent replay across sessions:
  - Commitment is session-specific only if commitment includes session_id in the hash.
  - Recommended improvement:
    - `commitment = Poseidon(session_id, player_address, move, salt)`
  - If implemented, the circuit and contract must both use the same formula.
- Frontend storage:
  - Salt stored locally; user responsibility. Warn clearly.
- DoS / griefing:
  - Deadlines + forfeit to avoid permanent lock.
- Tie handling:
  - Deterministic and consistent with GameHub bool limitation.

---

## 13. Deliverables

Repository structure suggestion:
- `contracts/rps_game/` — Soroban contract implementing session + verifier calls + GameHub integration
- `circuits/rps_commit/` — Noir circuit + build artifacts for bb.js
- `frontend/` — Game Studio-compatible UI:
  - commitment UI
  - proof generation with bb.js
  - soroban tx submission + polling

---

## 14. Open Implementation Choices (Decide During Build)

1) Commitment formula:
   - Minimal: `Poseidon(move, salt)`
   - Safer: `Poseidon(session_id, player, move, salt)` (recommended)

2) Session creation:
   - Explicit `create_session` (recommended for clarity)
   - Implicit on first commit (simpler but needs passing both players somewhere)

3) Tie → GameHub `player1_won`:
   - Recommended: `false` and emit `winner=0` event for frontend.

4) Public inputs encoding for verifier:
   - Must match the deployed verifier contract exactly; implement adapter if needed.

---

## 15. Milestone Plan (High Level)

- M1: Soroban session + commit/finalize logic (no ZK yet, mock verifier).
- M2: Noir circuit compiled + bb.js proof generation in browser.
- M3: On-chain verification integration (real verifier).
- M4: Full end-to-end demo UX polish + test coverage.
