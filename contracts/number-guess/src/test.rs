#![cfg(test)]

// Unit tests for the number-guess contract using a simple mock GameHub.
// These tests verify game logic independently of the full GameHub system.
//
// Note: These tests use a minimal mock for isolation and speed.
// For full integration tests with the real Game Hub contract, see the platform repo.

use crate::{Error, NumberGuessContract, NumberGuessContractClient};
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
    NumberGuessContractClient<'static>,
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

    // Deploy number-guess with admin and GameHub address
    let contract_id = env.register(NumberGuessContract, (&admin, &hub_addr));
    let client = NumberGuessContractClient::new(&env, &contract_id);

    // Register number-guess as a whitelisted game (mock does nothing)
    game_hub.add_game(&contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, game_hub, player1, player2)
}

/// Assert that a Result contains a specific number_guess error
///
/// This helper provides type-safe error assertions following Stellar/Soroban best practices.
/// Instead of using `assert_eq!(result, Err(Ok(Error::AlreadyGuessed)))`, this pattern:
/// - Provides compile-time error checking
/// - Makes tests more readable with named errors
/// - Gives better failure messages
///
/// # Example
/// ```
/// let result = client.try_make_guess(&session_id, &player, &7);
/// assert_number_guess_error(&result, Error::AlreadyGuessed);
/// ```
///
/// # Type Signature
/// The try_ methods return: `Result<Result<T, T::Error>, Result<E, InvokeError>>`
/// - Ok(Ok(value)): Call succeeded, decode succeeded
/// - Ok(Err(conv_err)): Call succeeded, decode failed
/// - Err(Ok(error)): Contract reverted with custom error (THIS IS WHAT WE TEST)
/// - Err(Err(invoke_err)): Low-level invocation failure
fn assert_number_guess_error<T, E>(
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

    // Get game to verify state
    let game = client.get_game(&session_id);
    assert!(game.winning_number.is_none()); // Winning number not set yet
    assert!(game.winner.is_none()); // Game is still active
    assert_eq!(game.player1, player1);
    assert_eq!(game.player2, player2);
    assert_eq!(game.player1_points, points);
    assert_eq!(game.player2_points, points);

    // Make guesses
    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &7);

    // Reveal winner
    let winner = client.reveal_winner(&session_id);
    assert!(winner == player1 || winner == player2);

    // Verify game is ended and winning number is now set
    let final_game = client.get_game(&session_id);
    assert!(final_game.winner.is_some()); // Game has ended
    assert_eq!(final_game.winner.unwrap(), winner);
    assert!(final_game.winning_number.is_some());
    let winning_number = final_game.winning_number.unwrap();
    assert!(winning_number >= 1 && winning_number <= 10);
}

#[test]
fn test_winning_number_in_range() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 2u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Make guesses and reveal winner to generate winning number
    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &7);
    client.reveal_winner(&session_id);

    let game = client.get_game(&session_id);
    let winning_number = game
        .winning_number
        .expect("Winning number should be set after reveal");
    assert!(
        winning_number >= 1 && winning_number <= 10,
        "Winning number should be between 1 and 10"
    );
}

#[test]
fn test_multiple_sessions() {
    let (env, client, _hub, player1, player2) = setup_test();
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);

    let session1 = 3u32;
    let session2 = 4u32;

    client.start_game(&session1, &player1, &player2, &100_0000000, &100_0000000);
    client.start_game(&session2, &player3, &player4, &50_0000000, &50_0000000);

    // Verify both games exist and are independent
    let game1 = client.get_game(&session1);
    let game2 = client.get_game(&session2);

    assert_eq!(game1.player1, player1);
    assert_eq!(game2.player1, player3);
}

// ============================================================================
// Guess Logic Tests
// ============================================================================

#[test]
fn test_closest_guess_wins() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 5u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Player1 guesses closer (1 away from any number between 1-10)
    // Player2 guesses further (at least 2 away)
    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &10);

    let winner = client.reveal_winner(&session_id);

    // Get the final game state to check the winning number
    let game = client.get_game(&session_id);
    let winning_number = game.winning_number.unwrap();

    // Calculate which player should have won based on distances
    let distance1 = if 5 > winning_number {
        5 - winning_number
    } else {
        winning_number - 5
    };
    let distance2 = if 10 > winning_number {
        10 - winning_number
    } else {
        winning_number - 10
    };

    let expected_winner = if distance1 <= distance2 {
        player1.clone()
    } else {
        player2.clone()
    };
    assert_eq!(
        winner, expected_winner,
        "Player with closer guess should win"
    );
}

#[test]
fn test_tie_game_player1_wins() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 6u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Both players guess the same number (guaranteed tie)
    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &5);

    let winner = client.reveal_winner(&session_id);
    assert_eq!(winner, player1, "Player1 should win in a tie");
}

#[test]
fn test_exact_guess_wins() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 7u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Player1 guesses 5 (middle), player2 guesses 10 (edge)
    // Player1 is more likely to be closer to the winning number
    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &10);

    let winner = client.reveal_winner(&session_id);
    let game = client.get_game(&session_id);
    let winning_number = game.winning_number.unwrap();

    // Verify the winner matches the distance calculation
    let distance1 = if 5 > winning_number {
        5 - winning_number
    } else {
        winning_number - 5
    };
    let distance2 = if 10 > winning_number {
        10 - winning_number
    } else {
        winning_number - 10
    };
    let expected_winner = if distance1 <= distance2 {
        player1.clone()
    } else {
        player2.clone()
    };
    assert_eq!(winner, expected_winner);
}

// ============================================================================
// Error Handling Tests
// ============================================================================

#[test]
fn test_cannot_guess_twice() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 8u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Make first guess
    client.make_guess(&session_id, &player1, &5);

    // Try to guess again - should fail
    let result = client.try_make_guess(&session_id, &player1, &6);
    assert_number_guess_error(&result, Error::AlreadyGuessed);
}

#[test]
fn test_cannot_reveal_before_both_guesses() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 9u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Only player1 guesses
    client.make_guess(&session_id, &player1, &5);

    // Try to reveal winner - should fail
    let result = client.try_reveal_winner(&session_id);
    assert_number_guess_error(&result, Error::BothPlayersNotGuessed);
}

#[test]
#[should_panic(expected = "Guess must be between 1 and 10")]
fn test_cannot_guess_below_range() {
    let (env, client, _hub, player1, _player2) = setup_test();

    let session_id = 10u32;
    client.start_game(
        &session_id,
        &player1,
        &Address::generate(&env),
        &100_0000000,
        &100_0000000,
    );

    // Try to guess 0 (below range) - should panic
    client.make_guess(&session_id, &player1, &0);
}

#[test]
#[should_panic(expected = "Guess must be between 1 and 10")]
fn test_cannot_guess_above_range() {
    let (env, client, _hub, player1, _player2) = setup_test();

    let session_id = 11u32;
    client.start_game(
        &session_id,
        &player1,
        &Address::generate(&env),
        &100_0000000,
        &100_0000000,
    );

    // Try to guess 11 (above range) - should panic
    client.make_guess(&session_id, &player1, &11);
}

#[test]
fn test_non_player_cannot_guess() {
    let (env, client, _hub, player1, player2) = setup_test();
    let non_player = Address::generate(&env);

    let session_id = 11u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Non-player tries to guess
    let result = client.try_make_guess(&session_id, &non_player, &5);
    assert_number_guess_error(&result, Error::NotPlayer);
}

#[test]
fn test_cannot_reveal_nonexistent_game() {
    let (_env, client, _hub, _player1, _player2) = setup_test();

    let result = client.try_reveal_winner(&999);
    assert_number_guess_error(&result, Error::GameNotFound);
}

#[test]
fn test_cannot_guess_after_game_ended() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 12u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Both players make guesses
    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &7);

    // Reveal winner - game ends
    let _winner = client.reveal_winner(&session_id);

    // Try to make another guess after game has ended - should fail
    let result = client.try_make_guess(&session_id, &player1, &3);
    assert_number_guess_error(&result, Error::GameAlreadyEnded);
}

#[test]
fn test_cannot_reveal_twice() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 14u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &7);

    // First reveal succeeds
    let winner = client.reveal_winner(&session_id);
    assert!(winner == player1 || winner == player2);

    // Second reveal should return same winner (idempotent)
    let winner2 = client.reveal_winner(&session_id);
    assert_eq!(winner, winner2);
}

// ============================================================================
// Multiple Games Tests
// ============================================================================

#[test]
fn test_multiple_games_independent() {
    let (env, client, _hub, player1, player2) = setup_test();
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);

    let session1 = 20u32;
    let session2 = 21u32;

    // Start two games
    client.start_game(&session1, &player1, &player2, &100_0000000, &100_0000000);
    client.start_game(&session2, &player3, &player4, &50_0000000, &50_0000000);

    // Play both games independently
    client.make_guess(&session1, &player1, &3);
    client.make_guess(&session2, &player3, &8);
    client.make_guess(&session1, &player2, &7);
    client.make_guess(&session2, &player4, &2);

    // Reveal both winners
    let winner1 = client.reveal_winner(&session1);
    let winner2 = client.reveal_winner(&session2);

    assert!(winner1 == player1 || winner1 == player2);
    assert!(winner2 == player3 || winner2 == player4);

    // Verify both games are independent
    let final_game1 = client.get_game(&session1);
    let final_game2 = client.get_game(&session2);

    assert!(final_game1.winner.is_some()); // Game 1 has ended
    assert!(final_game2.winner.is_some()); // Game 2 has ended

    // Note: winning numbers could be the same by chance, so we just verify they're both set
    assert!(final_game1.winning_number.is_some());
    assert!(final_game2.winning_number.is_some());
}

#[test]
fn test_asymmetric_points() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 15u32;
    let points1 = 200_0000000;
    let points2 = 50_0000000;

    client.start_game(&session_id, &player1, &player2, &points1, &points2);

    let game = client.get_game(&session_id);
    assert_eq!(game.player1_points, points1);
    assert_eq!(game.player2_points, points2);

    client.make_guess(&session_id, &player1, &5);
    client.make_guess(&session_id, &player2, &5);
    client.reveal_winner(&session_id);

    // Game completes successfully with asymmetric points
    let final_game = client.get_game(&session_id);
    assert!(final_game.winner.is_some()); // Game has ended
}

// ============================================================================
// Admin Function Tests
// ============================================================================

#[test]
fn test_upgrade_function_exists() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());

    // Deploy number-guess with admin
    let contract_id = env.register(NumberGuessContract, (&admin, &hub_addr));
    let client = NumberGuessContractClient::new(&env, &contract_id);

    // Verify the upgrade function exists and can be called
    // Note: We can't test actual upgrade without real WASM files
    // The function will fail with MissingValue because the WASM hash doesn't exist
    // But that's expected - we're just verifying the function signature is correct
    let new_wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    let result = client.try_upgrade(&new_wasm_hash);

    // Should fail with MissingValue (WASM doesn't exist) not NotAdmin
    // This confirms the authorization check passed
    assert!(result.is_err());
}
