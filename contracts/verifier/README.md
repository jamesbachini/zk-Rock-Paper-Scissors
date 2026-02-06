# Ultrahonk Verifier (Soroban)

Vendored from `indextree/ultrahonk_soroban_contract` and adapted to this repo’s
workspace. This contract stores the verification key (VK) at deploy time and
verifies Ultrahonk proofs on-chain.

## Build

```bash
stellar contract build --manifest-path contracts/verifier/Cargo.toml
```

Output: `target/wasm32v1-none/release/ultrahonk_soroban_contract.wasm`

## Deploy (VK Required)

The constructor expects `vk_bytes` generated from the Noir circuit artifacts.
For this game, use:

- `circuits/rps_commit/artifacts/vk.bin`

Example deploy:

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/ultrahonk_soroban_contract.wasm \
  --source <IDENTITY> \
  -- \
  --vk_bytes-file-path circuits/rps_commit/artifacts/vk.bin
```

## Verify Function

`verify_proof(public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error>`

The verifier expects the `public_inputs` byte blob to be a **concatenation of
32-byte field elements** (big-endian) in the same order produced by the Noir
circuit. For RPS, that is:

1. `commitment`
2. `move_public`

Total length: **64 bytes**.

## Proof Generation Note (Keccak)

The Soroban verifier uses **Keccak-256** for the Fiat–Shamir transcript.
When generating proofs in bb.js, pass `{ keccak: true }` so the proof matches
the on-chain verifier.
