#![cfg(test)]

// Unit tests for the RPS game contract using a simple mock GameHub.
// These tests verify game logic independently of the full GameHub system.

use crate::{Error, RpsGameContract, RpsGameContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contracterror, contractimpl, Address, Bytes, BytesN, Env, InvokeError};
use ultrahonk_soroban_contract::UltraHonkVerifierContract;

// ============================================================================
// Mock GameHub for Unit Testing
// ============================================================================

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
        // Mock implementation - does nothing
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
        // Mock implementation - does nothing
    }

    pub fn add_game(_env: Env, _game_address: Address) {
        // Mock implementation - does nothing
    }
}

// ============================================================================
// Mock Verifier for Unit Testing
// ============================================================================

#[contract]
pub struct MockVerifier;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MockVerifierError {
    InvalidProof = 1,
}

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, _public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), MockVerifierError> {
        if proof_bytes.len() == 0 {
            Err(MockVerifierError::InvalidProof)
        } else {
            Ok(())
        }
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

fn set_ledger(env: &Env, sequence_number: u32) {
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });
}

fn setup_test_with_windows(
    commit_window: u32,
    reveal_window: u32,
) -> (Env, RpsGameContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    set_ledger(&env, 100);

    let hub_addr = env.register(MockGameHub, ());
    let verifier_addr = env.register(MockVerifier, ());
    let contract_id = env.register(RpsGameContract, ());
    let client = RpsGameContractClient::new(&env, &contract_id);

    client.init(&hub_addr, &verifier_addr, &commit_window, &reveal_window);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, player1, player2)
}

fn commitment(env: &Env, value: u8) -> BytesN<32> {
    BytesN::from_array(env, &[value; 32])
}

fn dummy_proof(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[1u8; 32])
}

fn public_inputs(env: &Env, commitment: &BytesN<32>, mov: u32) -> Bytes {
    let mut bytes = Bytes::new(env);
    bytes.extend_from_slice(&commitment.to_array());

    let mut mov_bytes = [0u8; 32];
    mov_bytes[28..32].copy_from_slice(&mov.to_be_bytes());
    bytes.extend_from_slice(&mov_bytes);

    bytes
}

/// Assert that a Result contains a specific rps_game error
fn assert_rps_error<T, E>(
    result: &Result<Result<T, E>, Result<Error, InvokeError>>,
    expected_error: Error,
) {
    match result {
        Err(Ok(actual_error)) => {
            assert_eq!(
                *actual_error, expected_error,
                "Expected error {:?} (code {}), but got {:?} (code {})",
                expected_error, expected_error as u32, actual_error, *actual_error as u32
            );
        }
        Err(Err(_invoke_error)) => {
            panic!(
                "Expected contract error {:?} (code {}), but got invocation error",
                expected_error, expected_error as u32
            );
        }
        Ok(Err(_conv_error)) => {
            panic!(
                "Expected contract error {:?} (code {}), but got conversion error",
                expected_error, expected_error as u32
            );
        }
        Ok(Ok(_)) => {
            panic!(
                "Expected error {:?} (code {}), but operation succeeded",
                expected_error, expected_error as u32
            );
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_only_players_can_commit_and_reveal() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 1u32;

    client.create_session(&session_id, &player1, &player2);

    let outsider = Address::generate(&env);
    let result = client.try_commit_move(&session_id, &outsider, &commitment(&env, 1));
    assert_rps_error(&result, Error::NotPlayer);

    client.commit_move(&session_id, &player1, &commitment(&env, 2));

    let reveal_result = client.try_reveal_move(
        &session_id,
        &outsider,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 2), 0u32),
    );
    assert_rps_error(&reveal_result, Error::NotPlayer);
}

#[test]
fn test_commit_only_once() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 2u32;

    client.create_session(&session_id, &player1, &player2);
    client.commit_move(&session_id, &player1, &commitment(&env, 3));

    let result = client.try_commit_move(&session_id, &player1, &commitment(&env, 4));
    assert_rps_error(&result, Error::AlreadyCommitted);
}

#[test]
fn test_reveal_requires_commit() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 3u32;

    client.create_session(&session_id, &player1, &player2);

    let result = client.try_reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 5), 1u32),
    );
    assert_rps_error(&result, Error::CommitRequired);

    client.commit_move(&session_id, &player1, &commitment(&env, 5));
    client.reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 5), 2u32),
    );

    let second_reveal = client.try_reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 5), 2u32),
    );
    assert_rps_error(&second_reveal, Error::AlreadyRevealed);
}

#[test]
fn test_reveal_commitment_mismatch_rejected() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 9u32;

    client.create_session(&session_id, &player1, &player2);
    client.commit_move(&session_id, &player1, &commitment(&env, 1));

    let result = client.try_reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 2), 1u32),
    );
    assert_rps_error(&result, Error::CommitmentMismatch);
}

#[test]
fn test_reveal_invalid_move_rejected() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 10u32;

    client.create_session(&session_id, &player1, &player2);
    client.commit_move(&session_id, &player1, &commitment(&env, 3));

    let result = client.try_reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 3), 3u32),
    );
    assert_rps_error(&result, Error::InvalidMove);
}

#[test]
fn test_reveal_invalid_proof_rejected() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 11u32;

    client.create_session(&session_id, &player1, &player2);
    client.commit_move(&session_id, &player1, &commitment(&env, 4));

    let empty_proof = Bytes::new(&env);
    let result = client.try_reveal_move(
        &session_id,
        &player1,
        &empty_proof,
        &public_inputs(&env, &commitment(&env, 4), 0u32),
    );
    assert_rps_error(&result, Error::ProofVerificationFailed);
}

#[test]
fn test_deadlines_enforced() {
    let (env, client, player1, player2) = setup_test_with_windows(1, 1);
    let session_id = 4u32;

    client.create_session(&session_id, &player1, &player2);

    set_ledger(&env, 102); // commit_deadline = 101
    let result = client.try_commit_move(&session_id, &player1, &commitment(&env, 6));
    assert_rps_error(&result, Error::CommitWindowClosed);

    set_ledger(&env, 200);
    let session_id2 = 5u32;
    client.create_session(&session_id2, &player1, &player2);
    client.commit_move(&session_id2, &player1, &commitment(&env, 7));

    set_ledger(&env, 203); // reveal_deadline = 202
    let reveal_result = client.try_reveal_move(
        &session_id2,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 7), 1u32),
    );
    assert_rps_error(&reveal_result, Error::RevealWindowClosed);
}

#[test]
fn test_winner_matrix_all_combinations() {
    let cases = [
        (0u32, 0u32, 0u32),
        (0u32, 1u32, 2u32),
        (0u32, 2u32, 1u32),
        (1u32, 0u32, 1u32),
        (1u32, 1u32, 0u32),
        (1u32, 2u32, 2u32),
        (2u32, 0u32, 2u32),
        (2u32, 1u32, 1u32),
        (2u32, 2u32, 0u32),
    ];

    for (index, (p1_move, p2_move, expected)) in cases.iter().enumerate() {
        let (env, client, player1, player2) = setup_test_with_windows(10, 10);
        let session_id = (100 + index) as u32;

        client.create_session(&session_id, &player1, &player2);
        client.commit_move(&session_id, &player1, &commitment(&env, 10));
        client.commit_move(&session_id, &player2, &commitment(&env, 20));
        client.reveal_move(
            &session_id,
            &player1,
            &dummy_proof(&env),
            &public_inputs(&env, &commitment(&env, 10), *p1_move),
        );
        client.reveal_move(
            &session_id,
            &player2,
            &dummy_proof(&env),
            &public_inputs(&env, &commitment(&env, 20), *p2_move),
        );
        client.finalize(&session_id);

        let session = client.get_session(&session_id);
        assert_eq!(session.winner, Some(*expected));
    }
}

#[test]
fn test_forfeit_only_one_commits() {
    let (env, client, player1, player2) = setup_test_with_windows(5, 5);
    let session_id = 6u32;

    client.create_session(&session_id, &player1, &player2);
    client.commit_move(&session_id, &player1, &commitment(&env, 30));

    set_ledger(&env, 107); // commit_deadline = 105
    client.finalize(&session_id);

    let session = client.get_session(&session_id);
    assert_eq!(session.winner, Some(1));
}

#[test]
fn test_forfeit_only_one_reveals() {
    let (env, client, player1, player2) = setup_test_with_windows(5, 5);
    let session_id = 7u32;

    client.create_session(&session_id, &player1, &player2);
    client.commit_move(&session_id, &player1, &commitment(&env, 40));
    client.commit_move(&session_id, &player2, &commitment(&env, 50));
    client.reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 40), 1u32),
    );

    set_ledger(&env, 111); // reveal_deadline = 110
    client.finalize(&session_id);

    let session = client.get_session(&session_id);
    assert_eq!(session.winner, Some(1));
}

#[test]
fn test_getters_return_expected_values() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 12u32;

    client.create_session(&session_id, &player1, &player2);

    assert_eq!(client.get_commitment(&session_id, &player1), None);
    assert_eq!(client.get_move(&session_id, &player1), None);

    let commit1 = commitment(&env, 9);
    client.commit_move(&session_id, &player1, &commit1);
    assert_eq!(client.get_commitment(&session_id, &player1), Some(commit1.clone()));
    assert_eq!(client.get_commitment(&session_id, &player2), None);

    client.reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commit1, 2u32),
    );
    assert_eq!(client.get_move(&session_id, &player1), Some(2u32));
    assert_eq!(client.get_move(&session_id, &player2), None);

    let outsider = Address::generate(&env);
    let result = client.try_get_commitment(&session_id, &outsider);
    assert_rps_error(&result, Error::NotPlayer);
}

#[test]
fn test_finalize_idempotency() {
    let (env, client, player1, player2) = setup_test_with_windows(10, 10);
    let session_id = 8u32;

    client.create_session(&session_id, &player1, &player2);
    client.commit_move(&session_id, &player1, &commitment(&env, 60));
    client.commit_move(&session_id, &player2, &commitment(&env, 70));
    client.reveal_move(
        &session_id,
        &player1,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 60), 0u32),
    );
    client.reveal_move(
        &session_id,
        &player2,
        &dummy_proof(&env),
        &public_inputs(&env, &commitment(&env, 70), 2u32),
    );
    client.finalize(&session_id);

    let result = client.try_finalize(&session_id);
    assert_rps_error(&result, Error::AlreadyFinalized);
}

#[test]
fn test_e2e_real_proof_verification() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    set_ledger(&env, 100);

    let vk_bytes_raw: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/vk.bin");
    let proof_raw: &[u8] = include_bytes!("../../../circuits/rps_commit/artifacts/proof.bin");
    let public_inputs_raw: &[u8] =
        include_bytes!("../../../circuits/rps_commit/artifacts/public_inputs.bin");

    assert_eq!(public_inputs_raw.len(), 64);

    let vk_bytes = Bytes::from_slice(&env, vk_bytes_raw);
    let proof_bytes = Bytes::from_slice(&env, proof_raw);
    let public_inputs = Bytes::from_slice(&env, public_inputs_raw);

    let verifier_addr = env.register(UltraHonkVerifierContract, (vk_bytes,));
    let hub_addr = env.register(MockGameHub, ());
    let contract_id = env.register(RpsGameContract, ());
    let client = RpsGameContractClient::new(&env, &contract_id);

    client.init(&hub_addr, &verifier_addr, &10u32, &10u32);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let session_id = 500u32;

    client.create_session(&session_id, &player1, &player2);

    let mut commitment_arr = [0u8; 32];
    commitment_arr.copy_from_slice(&public_inputs_raw[0..32]);
    let commitment = BytesN::from_array(&env, &commitment_arr);

    client.commit_move(&session_id, &player1, &commitment);
    client.commit_move(&session_id, &player2, &commitment);

    client.reveal_move(&session_id, &player1, &proof_bytes, &public_inputs);
    client.reveal_move(&session_id, &player2, &proof_bytes, &public_inputs);
    client.finalize(&session_id);

    let session = client.get_session(&session_id);
    assert_eq!(session.winner, Some(0));
}
