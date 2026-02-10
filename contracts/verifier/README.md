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

## Verify Functions

### Primary: Poseidon2 Transcript

`verify_proof_poseidon2(public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error>`

This is the **primary verification path** and uses **Poseidon2** for the Fiat–Shamir transcript.
Poseidon2 is more efficient on Stellar/Soroban than Keccak-256 and avoids budget limit issues.

#### Poseidon2 Transcript Encoding (Exact)

To match bb.js/Barretenberg UltraHonk transcript hashing:

- The transcript hash input is treated as a sequence of **BN254 Fr elements**, not arbitrary bytes.
- Each element is encoded as **32-byte big-endian**.
- Soroban adapter maps each 32-byte chunk directly to `U256::from_be_bytes` (no byte reversal).
- Hash call is `env.crypto().poseidon2_hash(&Vec<U256>, "BN254")`.
- No extra domain labels are injected by the adapter.

A deterministic parity fixture is generated from bb.js at:

- `circuits/rps_commit/artifacts/transcript_poseidon2_trace.txt`

and verified in Rust by:

- `contracts/verifier/ultrahonk-soroban-verifier/tests/poseidon2_parity_test.rs`

### Legacy: Keccak Transcript

`verify_proof(public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error>`

Legacy verification using **Keccak-256** for the transcript. Maintained for backward compatibility.

### Public Inputs Format

Both functions expect the `public_inputs` byte blob to be a **concatenation of
32-byte field elements** (big-endian) in the same order produced by the Noir
circuit. For RPS, that is:

1. `commitment`
2. `move_public`

Total length: **64 bytes**.

## Proof Generation Note

**Default (Poseidon2):** Generate proofs in bb.js without the `{ keccak: true }` flag.
By default, bb.js uses Poseidon2 for the transcript, which matches `verify_proof_poseidon2`.

**Legacy (Keccak):** To generate Keccak-based proofs for the legacy `verify_proof` entry point,
pass `{ keccak: true }` to `backend.generateProof(witness, { keccak: true })`.
