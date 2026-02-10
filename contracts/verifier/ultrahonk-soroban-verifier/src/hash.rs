use soroban_sdk::{Bytes, Symbol, U256, Vec};

/// Hash algorithm selection for Fiat-Shamir transcript
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptHash {
    Keccak,
    Poseidon2,
}

/// Compute Keccak-256 using the Soroban host function.
#[inline(always)]
pub fn hash32(data: &Bytes) -> [u8; 32] {
    data.env().crypto().keccak256(data).to_array()
}

/// Compute Poseidon2 hash using the Soroban host function.
/// Converts input bytes to field elements (32-byte chunks, reversed endianness).
pub fn hash32_poseidon2(data: &Bytes) -> [u8; 32] {
    let env = data.env();
    let mut inputs = Vec::new(&env);

    let len = data.len();
    let mut idx = 0u32;

    // Process input in 32-byte chunks
    while idx < len {
        let remaining = len - idx;
        let chunk_size = if remaining >= 32 { 32 } else { remaining };

        let mut buf = [0u8; 32];
        // Copy chunk into buffer
        for i in 0..chunk_size {
            buf[i as usize] = data.get_unchecked(idx + i);
        }

        // Reverse the buffer for endianness conversion (per PR convention)
        buf.reverse();

        // Convert to U256 via Bytes
        let chunk_bytes = Bytes::from_array(&env, &buf);
        let field_element = U256::from_be_bytes(&env, &chunk_bytes);
        inputs.push_back(field_element);

        idx += chunk_size;
    }

    // Call poseidon2_hash with BN254 curve parameter
    let field = Symbol::new(&env, "BN254");
    let result = env.crypto().poseidon2_hash(&inputs, field);

    // Convert U256 result back to [u8; 32]
    let result_bytes = result.to_be_bytes();
    let mut output = [0u8; 32];
    for i in 0u32..32u32 {
        output[i as usize] = result_bytes.get_unchecked(i);
    }
    output
}

/// Dispatch to the appropriate hash function based on hasher type.
pub fn hash_with(data: &Bytes, hasher: &TranscriptHash) -> [u8; 32] {
    match hasher {
        TranscriptHash::Keccak => hash32(data),
        TranscriptHash::Poseidon2 => hash32_poseidon2(data),
    }
}
