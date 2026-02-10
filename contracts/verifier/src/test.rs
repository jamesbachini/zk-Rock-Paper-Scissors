#![cfg(test)]

use crate::{Error, UltraHonkVerifierContract, UltraHonkVerifierContractClient};
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{Bytes, ConversionError, Env, InvokeError};

fn new_env() -> Env {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_protocol_version(25);
    env
}

fn assert_verifier_error(
    result: &Result<Result<(), ConversionError>, Result<Error, InvokeError>>,
    expected: Error,
) {
    match result {
        Err(Ok(actual)) => assert_eq!(*actual, expected),
        _ => panic!("expected verifier error {:?}", expected),
    }
}

#[test]
fn test_poseidon2_entrypoint_accepts_poseidon2_proof() {
    let env = new_env();
    let vk_raw: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/vk.bin");
    let proof_raw: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/proof.bin");
    let public_inputs_raw: &[u8] =
        include_bytes!("../../../circuits/rps_commit/artifacts/public_inputs.bin");

    let contract_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, vk_raw),),
    );
    let client = UltraHonkVerifierContractClient::new(&env, &contract_id);

    client.verify_proof_poseidon2(
        &Bytes::from_slice(&env, public_inputs_raw),
        &Bytes::from_slice(&env, proof_raw),
    );
}

#[test]
fn test_keccak_entrypoint_accepts_keccak_proof() {
    let env = new_env();
    let vk_raw: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/vk_keccak.bin");
    let proof_raw: &[u8] =
        include_bytes!("../../../circuits/rps_commit/artifacts/proof_keccak.bin");
    let public_inputs_raw: &[u8] =
        include_bytes!("../../../circuits/rps_commit/artifacts/public_inputs_keccak.bin");

    let contract_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, vk_raw),),
    );
    let client = UltraHonkVerifierContractClient::new(&env, &contract_id);

    client.verify_proof(
        &Bytes::from_slice(&env, public_inputs_raw),
        &Bytes::from_slice(&env, proof_raw),
    );
}

#[test]
fn test_cross_transcript_proofs_are_rejected() {
    let env = new_env();
    let poseidon_vk: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/vk.bin");
    let poseidon_proof: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/proof.bin");
    let poseidon_inputs: &[u8] =
        include_bytes!("../../../circuits/rps_commit/artifacts/public_inputs.bin");

    let keccak_vk: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/vk_keccak.bin");
    let keccak_proof: &[u8] =
        include_bytes!("../../../circuits/rps_commit/artifacts/proof_keccak.bin");
    let keccak_inputs: &[u8] =
        include_bytes!("../../../circuits/rps_commit/artifacts/public_inputs_keccak.bin");

    let poseidon_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, poseidon_vk),),
    );
    let keccak_id = env.register(
        UltraHonkVerifierContract,
        (Bytes::from_slice(&env, keccak_vk),),
    );

    let poseidon_client = UltraHonkVerifierContractClient::new(&env, &poseidon_id);
    let keccak_client = UltraHonkVerifierContractClient::new(&env, &keccak_id);

    let keccak_on_poseidon = poseidon_client.try_verify_proof(
        &Bytes::from_slice(&env, poseidon_inputs),
        &Bytes::from_slice(&env, poseidon_proof),
    );
    assert_verifier_error(&keccak_on_poseidon, Error::VerificationFailed);

    let poseidon_on_keccak = keccak_client.try_verify_proof_poseidon2(
        &Bytes::from_slice(&env, keccak_inputs),
        &Bytes::from_slice(&env, keccak_proof),
    );
    assert_verifier_error(&poseidon_on_keccak, Error::VerificationFailed);
}
