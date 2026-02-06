#![cfg(test)]

// Unit tests for the dice-duel contract using a simple mock GameHub.
// These tests verify game logic independently of the full GameHub system.

use crate::{DiceDuelContract, DiceDuelContractClient, Error};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

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
// Test Helpers
// ============================================================================

fn setup_test() -> (
    Env,
    DiceDuelContractClient<'static>,
    MockGameHubClient<'static>,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    // Set ledger info for time-based operations
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    // Deploy mock GameHub contract
    let hub_addr = env.register(MockGameHub, ());
    let game_hub = MockGameHubClient::new(&env, &hub_addr);

    // Create admin address
    let admin = Address::generate(&env);

    // Deploy dice-duel with admin and GameHub address
    let contract_id = env.register(DiceDuelContract, (&admin, &hub_addr));
    let client = DiceDuelContractClient::new(&env, &contract_id);

    // Register dice-duel as a whitelisted game (mock does nothing)
    game_hub.add_game(&contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, game_hub, player1, player2)
}

/// Assert that a Result contains a specific dice_duel error
fn assert_dice_duel_error<T, E>(
    result: &Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
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
// Basic Game Flow Tests
// ============================================================================

#[test]
fn test_complete_game() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 1u32;
    let points = 100_0000000;

    // Start game
    client.start_game(&session_id, &player1, &player2, &points, &points);

    // Verify initial state
    let game = client.get_game(&session_id);
    assert!(game.winner.is_none());
    assert_eq!(game.player1, player1);
    assert_eq!(game.player2, player2);
    assert_eq!(game.player1_points, points);
    assert_eq!(game.player2_points, points);
    assert_eq!(game.player1_rolled, false);
    assert_eq!(game.player2_rolled, false);
    assert!(game.player1_die1.is_none());
    assert!(game.player1_die2.is_none());
    assert!(game.player2_die1.is_none());
    assert!(game.player2_die2.is_none());

    // Players roll
    client.roll(&session_id, &player1);
    client.roll(&session_id, &player2);

    // Reveal winner
    let winner = client.reveal_winner(&session_id);
    assert!(winner == player1 || winner == player2);

    // Verify dice values and winner stored
    let final_game = client.get_game(&session_id);
    assert!(final_game.winner.is_some());
    assert_eq!(final_game.winner.unwrap(), winner);

    let p1d1 = final_game.player1_die1.unwrap();
    let p1d2 = final_game.player1_die2.unwrap();
    let p2d1 = final_game.player2_die1.unwrap();
    let p2d2 = final_game.player2_die2.unwrap();

    assert!((1..=6).contains(&p1d1));
    assert!((1..=6).contains(&p1d2));
    assert!((1..=6).contains(&p2d1));
    assert!((1..=6).contains(&p2d2));

    let total1 = p1d1 + p1d2;
    let total2 = p2d1 + p2d2;
    assert!((2..=12).contains(&total1));
    assert!((2..=12).contains(&total2));
}

#[test]
fn test_cannot_roll_twice() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 2u32;
    let points = 100_0000000;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    client.roll(&session_id, &player1);
    let result = client.try_roll(&session_id, &player1);
    assert_dice_duel_error(&result, Error::AlreadyRolled);
}

#[test]
fn test_cannot_reveal_before_both_roll() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 3u32;
    let points = 100_0000000;

    client.start_game(&session_id, &player1, &player2, &points, &points);
    client.roll(&session_id, &player1);

    let result = client.try_reveal_winner(&session_id);
    assert_dice_duel_error(&result, Error::BothPlayersNotRolled);
}

#[test]
fn test_non_player_cannot_roll() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 4u32;
    let points = 100_0000000;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let non_player = Address::generate(&_env);
    let result = client.try_roll(&session_id, &non_player);
    assert_dice_duel_error(&result, Error::NotPlayer);
}

#[test]
fn test_cannot_roll_after_game_ended() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 5u32;
    let points = 100_0000000;

    client.start_game(&session_id, &player1, &player2, &points, &points);
    client.roll(&session_id, &player1);
    client.roll(&session_id, &player2);
    client.reveal_winner(&session_id);

    let result = client.try_roll(&session_id, &player1);
    assert_dice_duel_error(&result, Error::GameAlreadyEnded);
}

#[test]
fn test_upgrade_function_exists() {
    let (_env, client, _hub, _player1, _player2) = setup_test();

    // Verify upgrade function is callable by admin (mocked auth)
    let new_wasm_hash = BytesN::from_array(&_env, &[0u8; 32]);
    let result = client.try_upgrade(&new_wasm_hash);

    // Should fail (WASM doesn't exist) but confirms function signature is correct
    assert!(result.is_err());
}
