# RPS Game (Ultrahonk Reveal)

Two-player Rock/Paper/Scissors contract with commit/reveal timeouts and GameHub lifecycle integration.
Reveals are verified on-chain via the Ultrahonk verifier contract.

## Methods

- `init(game_hub, verifier, commit_window, reveal_window)`
- `create_session(session_id, player1, player2)`
- `commit_move(session_id, player, commitment)`
- `reveal_move(session_id, player, proof, public_inputs)`
- `finalize(session_id)`
- `get_session(session_id)`

## Public Inputs Encoding (Canonical)

`public_inputs` is a byte blob containing **two** 32-byte field elements (BN254 Fr),
concatenated **big-endian**:

1. `commitment` (Poseidon2 commitment, 32 bytes)
2. `move_public` (0, 1, or 2 encoded as a 32-byte big-endian field)

Total length: **64 bytes**. This must match the circuit output ordering in
`circuits/rps_commit/README.md`.

## Verifier Contract

Deploy `contracts/verifier` (Ultrahonk verifier) first, then pass its address into
`init`. The verifier constructor requires `vk_bytes` generated from the circuit.
See `contracts/verifier/README.md` for build and deploy steps.

**Important:** proofs must be generated with bb.js using `{ keccak: true }`
to match the verifier’s Fiat–Shamir hash.

## Deploy Order (Summary)

1. Deploy verifier with `vk.bin` from `circuits/rps_commit/artifacts/`.
2. Deploy `rps_game.wasm`.
3. Invoke `init(game_hub, verifier, commit_window, reveal_window)`.

## Events

- `SessionCreated`
- `MoveCommitted`
- `MoveRevealed`
- `Finalized`

## Build

```bash
stellar contract build --manifest-path contracts/rps_game/Cargo.toml
```

Output: `target/wasm32v1-none/release/rps_game.wasm`

## Test

```bash
cargo test -p rps_game
```
