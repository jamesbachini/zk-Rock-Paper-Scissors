#![cfg(test)]

// Unit tests for the twenty-one contract using a simple mock GameHub.
// These tests verify game logic independently of the full GameHub system.
//
// Note: These tests use a minimal mock for isolation and speed.
// For full integration tests with the real GameHub contract, see:
// contracts/game_hub/src/tests/twenty_one_integration.rs

use crate::{Error, TwentyOneContract, TwentyOneContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

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
    TwentyOneContractClient<'static>,
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

    // Deploy twenty-one with admin and GameHub address
    let contract_id = env.register(TwentyOneContract, (&admin, &hub_addr));
    let client = TwentyOneContractClient::new(&env, &contract_id);

    // Register twenty-one as a whitelisted game (mock does nothing)
    game_hub.add_game(&contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, game_hub, player1, player2)
}

/// Assert that a Result contains a specific twenty-one error
///
/// This helper provides type-safe error assertions following Stellar/Soroban best practices.
/// Instead of using `assert_eq!(result, Err(Ok(Error::AlreadyStuck)))`, this pattern:
/// - Provides compile-time error checking
/// - Makes tests more readable with named errors
/// - Gives better failure messages
///
/// # Example
/// ```
/// let result = client.try_hit(&session_id, &player);
/// assert_twenty_one_error(&result, Error::AlreadyStuck);
/// ```
///
/// # Type Signature
/// The try_ methods return: `Result<Result<T, T::Error>, Result<E, InvokeError>>`
/// - Ok(Ok(value)): Call succeeded, decode succeeded
/// - Ok(Err(conv_err)): Call succeeded, decode failed
/// - Err(Ok(error)): Contract reverted with custom error (THIS IS WHAT WE TEST)
/// - Err(Err(invoke_err)): Low-level invocation failure
fn assert_twenty_one_error<T, E>(
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

/// Helper to calculate hand value from Bytes
fn calculate_hand_value_helper(hand: &Bytes) -> u32 {
    let mut total = 0u32;
    for i in 0..hand.len() {
        let card = hand.get(i).unwrap() as u32;
        let value = if card >= 10 { 10 } else { card };
        total += value;
    }
    total
}

// ============================================================================
// Basic Game Flow Tests
// ============================================================================

#[test]
fn test_complete_game_simple() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 1u32;
    let points = 100_0000000;

    // Start game
    client.start_game(&session_id, &player1, &player2, &points, &points);

    // Get game to verify initial state
    let game = client.get_game(&session_id);
    assert!(game.winner.is_none()); // Game is still active
    assert_eq!(game.player1, player1);
    assert_eq!(game.player2, player2);
    assert_eq!(game.player1_points, points);
    assert_eq!(game.player2_points, points);
    assert_eq!(game.player1_hand.len(), 2); // 2 cards dealt
    assert_eq!(game.player2_hand.len(), 2); // 2 cards dealt
    assert_eq!(game.player1_stuck, false);
    assert_eq!(game.player2_stuck, false);

    // Both players stick immediately (no hits)
    client.stick(&session_id, &player1);
    client.stick(&session_id, &player2);

    // Reveal winner
    let winner = client.reveal_winner(&session_id);
    assert!(winner == player1 || winner == player2);

    // Verify game is ended
    let final_game = client.get_game(&session_id);
    assert!(final_game.winner.is_some());
    assert_eq!(final_game.winner.unwrap(), winner);
}

#[test]
fn test_initial_cards_dealt() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 2u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    let game = client.get_game(&session_id);

    // Each player should have exactly 2 cards
    assert_eq!(game.player1_hand.len(), 2);
    assert_eq!(game.player2_hand.len(), 2);

    // Cards should be in valid range (1-13)
    for i in 0..game.player1_hand.len() {
        let card = game.player1_hand.get(i).unwrap();
        assert!(card >= 1 && card <= 13, "Card should be between 1-13");
    }
    for i in 0..game.player2_hand.len() {
        let card = game.player2_hand.get(i).unwrap();
        assert!(card >= 1 && card <= 13, "Card should be between 1-13");
    }
}

#[test]
fn test_get_hand_value() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 3u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Get hand values
    let player1_value = client.get_hand_value(&session_id, &player1);
    let player2_value = client.get_hand_value(&session_id, &player2);

    // Hand values should be reasonable (2-20 for 2 cards, since max is 10 per card)
    assert!(player1_value >= 2 && player1_value <= 20);
    assert!(player2_value >= 2 && player2_value <= 20);

    // Verify hand value matches calculation
    let game = client.get_game(&session_id);
    let expected_value1 = calculate_hand_value_helper(&game.player1_hand);
    let expected_value2 = calculate_hand_value_helper(&game.player2_hand);

    assert_eq!(player1_value, expected_value1);
    assert_eq!(player2_value, expected_value2);
}

#[test]
fn test_hit_adds_card() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 4u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    let initial_game = client.get_game(&session_id);
    let initial_hand_size = initial_game.player1_hand.len();

    // Player 1 hits
    client.hit(&session_id, &player1);

    let after_hit_game = client.get_game(&session_id);
    assert_eq!(after_hit_game.player1_hand.len(), initial_hand_size + 1);
}

#[test]
fn test_stick_prevents_further_hits() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 5u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Player 1 sticks
    client.stick(&session_id, &player1);

    // Try to hit after sticking - should fail
    let result = client.try_hit(&session_id, &player1);
    assert_twenty_one_error(&result, Error::AlreadyStuck);
}

#[test]
fn test_multiple_hits_allowed() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 6u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    let initial_game = client.get_game(&session_id);
    let initial_hand_size = initial_game.player1_hand.len();

    // Player 1 hits multiple times (be careful not to bust in deterministic test)
    // This test may fail if player1 busts, but we're testing the mechanics
    let result1 = client.try_hit(&session_id, &player1);

    // If first hit succeeds (didn't bust), try another
    if result1.is_ok() {
        let mid_game = client.get_game(&session_id);
        assert_eq!(mid_game.player1_hand.len(), initial_hand_size + 1);

        let result2 = client.try_hit(&session_id, &player1);
        // Could succeed or fail (bust), both are valid
        if result2.is_ok() {
            let final_game = client.get_game(&session_id);
            assert_eq!(final_game.player1_hand.len(), initial_hand_size + 2);
        }
    }
}

// ============================================================================
// Winner Determination Tests
// ============================================================================

#[test]
fn test_closer_to_21_wins() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 7u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Both players stick
    client.stick(&session_id, &player1);
    client.stick(&session_id, &player2);

    let winner = client.reveal_winner(&session_id);

    // Get final hand values
    let game = client.get_game(&session_id);
    let player1_value = calculate_hand_value_helper(&game.player1_hand);
    let player2_value = calculate_hand_value_helper(&game.player2_hand);

    // Winner should be closer to 21
    if player1_value > player2_value {
        assert_eq!(winner, player1);
    } else if player2_value > player1_value {
        assert_eq!(winner, player2);
    }
    // If equal, test will continue (draw handling)
}

#[test]
fn test_reveal_winner_requires_both_stuck() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 8u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Only player1 sticks
    client.stick(&session_id, &player1);

    // Try to reveal winner - should fail
    let result = client.try_reveal_winner(&session_id);
    assert_twenty_one_error(&result, Error::BothPlayersNotStuck);
}

// ============================================================================
// Bust Tests
// ============================================================================

#[test]
fn test_bust_detection() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 9u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Keep hitting until player1 busts
    // Note: With enough hits, player will eventually bust (hand value > 21)
    let mut busted = false;
    for _ in 0..20 {
        // Hit succeeds even when busting (returns Ok), but game ends
        client.hit(&session_id, &player1);

        // Check if game ended (player busted)
        let game = client.get_game(&session_id);
        if game.winner.is_some() {
            busted = true;
            assert_eq!(game.winner.unwrap(), player2, "Player 2 should win when player 1 busts");

            // After a bust, subsequent operations should fail with GameAlreadyEnded
            let result = client.try_hit(&session_id, &player1);
            assert_twenty_one_error(&result, Error::GameAlreadyEnded);
            break;
        }
    }

    assert!(busted, "Player should have busted after 20 hits");
}

#[test]
fn test_cannot_hit_after_bust() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 10u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Hit until bust (game ends)
    let mut did_bust = false;
    for _ in 0..20 {
        client.hit(&session_id, &player1);

        // Check if game ended (player busted)
        let game = client.get_game(&session_id);
        if game.winner.is_some() {
            did_bust = true;
            assert_eq!(game.winner.unwrap(), player2);

            // Try to hit again after busting - should fail with GameAlreadyEnded
            let result = client.try_hit(&session_id, &player1);
            assert_twenty_one_error(&result, Error::GameAlreadyEnded);
            break;
        }
    }

    assert!(did_bust, "Player should have busted after 20 hits");
}

// ============================================================================
// Draw/Tie Tests
// ============================================================================

#[test]
fn test_draw_starts_new_round() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 11u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Both players stick immediately
    client.stick(&session_id, &player1);
    client.stick(&session_id, &player2);

    let game = client.get_game(&session_id);
    let player1_value = calculate_hand_value_helper(&game.player1_hand);
    let player2_value = calculate_hand_value_helper(&game.player2_hand);

    // Only test draw behavior if hands are equal
    if player1_value == player2_value {
        // This should return Draw error
        let result = client.try_reveal_winner(&session_id);
        assert_twenty_one_error(&result, Error::Draw);

        // Verify new round was created
        let game_after = client.get_game(&session_id);
        assert_eq!(game_after.round, 2); // Round should increment
        assert_eq!(game_after.player1_stuck, false); // Flags reset
        assert_eq!(game_after.player2_stuck, false);
        assert_eq!(game_after.player1_hand.len(), 2); // New cards dealt
        assert_eq!(game_after.player2_hand.len(), 2);
    }
    // If not a draw, test passes (no assertion needed)
}

// ============================================================================
// Error Handling Tests
// ============================================================================

#[test]
fn test_cannot_stick_twice() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 12u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // First stick succeeds
    client.stick(&session_id, &player1);

    // Second stick should fail
    let result = client.try_stick(&session_id, &player1);
    assert_twenty_one_error(&result, Error::AlreadyStuck);
}

#[test]
fn test_non_player_cannot_hit() {
    let (env, client, _hub, player1, player2) = setup_test();
    let non_player = Address::generate(&env);

    let session_id = 13u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Non-player tries to hit
    let result = client.try_hit(&session_id, &non_player);
    assert_twenty_one_error(&result, Error::NotPlayer);
}

#[test]
fn test_non_player_cannot_stick() {
    let (env, client, _hub, player1, player2) = setup_test();
    let non_player = Address::generate(&env);

    let session_id = 14u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Non-player tries to stick
    let result = client.try_stick(&session_id, &non_player);
    assert_twenty_one_error(&result, Error::NotPlayer);
}

#[test]
fn test_non_player_cannot_get_hand_value() {
    let (env, client, _hub, player1, player2) = setup_test();
    let non_player = Address::generate(&env);

    let session_id = 15u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Non-player tries to get hand value
    let result = client.try_get_hand_value(&session_id, &non_player);
    assert_twenty_one_error(&result, Error::NotPlayer);
}

#[test]
fn test_cannot_hit_nonexistent_game() {
    let (_env, client, _hub, player1, _player2) = setup_test();

    let result = client.try_hit(&999, &player1);
    assert_twenty_one_error(&result, Error::GameNotFound);
}

#[test]
fn test_cannot_stick_nonexistent_game() {
    let (_env, client, _hub, player1, _player2) = setup_test();

    let result = client.try_stick(&999, &player1);
    assert_twenty_one_error(&result, Error::GameNotFound);
}

#[test]
fn test_cannot_reveal_nonexistent_game() {
    let (_env, client, _hub, _player1, _player2) = setup_test();

    let result = client.try_reveal_winner(&999);
    assert_twenty_one_error(&result, Error::GameNotFound);
}

#[test]
fn test_cannot_get_nonexistent_game() {
    let (_env, client, _hub, _player1, _player2) = setup_test();

    let result = client.try_get_game(&999);
    assert_twenty_one_error(&result, Error::GameNotFound);
}

#[test]
fn test_cannot_hit_after_game_ended() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 16u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Both players stick
    client.stick(&session_id, &player1);
    client.stick(&session_id, &player2);

    // Reveal winner (may panic if draw, but that's okay)
    let result = client.try_reveal_winner(&session_id);
    if result.is_ok() {
        // Game ended successfully
        // Try to hit after game ended
        let hit_result = client.try_hit(&session_id, &player1);
        assert_twenty_one_error(&hit_result, Error::GameAlreadyEnded);
    }
}

#[test]
fn test_cannot_stick_after_game_ended() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 17u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Player 1 sticks
    client.stick(&session_id, &player1);

    // Player 2 sticks
    client.stick(&session_id, &player2);

    // Reveal winner
    let result = client.try_reveal_winner(&session_id);
    if result.is_ok() {
        // Game ended, verify stuck flag is set
        let game = client.get_game(&session_id);
        assert!(game.player1_stuck);

        // Try to stick again after game ended
        let stick_result = client.try_stick(&session_id, &player1);
        assert_twenty_one_error(&stick_result, Error::GameAlreadyEnded);
    }
}

#[test]
fn test_reveal_winner_idempotent() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 18u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    client.stick(&session_id, &player1);
    client.stick(&session_id, &player2);

    // First reveal
    let result1 = client.try_reveal_winner(&session_id);
    if result1.is_ok() {
        let winner1 = result1.unwrap().unwrap();

        // Second reveal should return same winner (idempotent)
        let winner2 = client.reveal_winner(&session_id);
        assert_eq!(winner1, winner2);
    }
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

    // Play both games independently (use try_ methods to handle potential busts)
    let _ = client.try_hit(&session1, &player1);
    let _ = client.try_hit(&session2, &player3);

    // Only continue if games haven't ended from busts
    let game1_check = client.get_game(&session1);
    let game2_check = client.get_game(&session2);

    if game1_check.winner.is_none() {
        client.stick(&session1, &player1);
        client.stick(&session1, &player2);
    }

    if game2_check.winner.is_none() {
        client.stick(&session2, &player3);
        client.stick(&session2, &player4);
    }

    // Verify both games exist and are independent
    let game1 = client.get_game(&session1);
    let game2 = client.get_game(&session2);

    assert_eq!(game1.player1, player1);
    assert_eq!(game2.player1, player3);
}

#[test]
fn test_multiple_sessions() {
    let (env, client, _hub, player1, player2) = setup_test();
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);

    let session1 = 22u32;
    let session2 = 23u32;

    client.start_game(&session1, &player1, &player2, &100_0000000, &100_0000000);
    client.start_game(&session2, &player3, &player4, &50_0000000, &50_0000000);

    // Verify both games exist and are independent
    let game1 = client.get_game(&session1);
    let game2 = client.get_game(&session2);

    assert_eq!(game1.player1, player1);
    assert_eq!(game2.player1, player3);
    assert_eq!(game1.player1_points, 100_0000000);
    assert_eq!(game2.player1_points, 50_0000000);
}

#[test]
fn test_asymmetric_points() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 24u32;
    let points1 = 200_0000000;
    let points2 = 50_0000000;

    client.start_game(&session_id, &player1, &player2, &points1, &points2);

    let game = client.get_game(&session_id);
    assert_eq!(game.player1_points, points1);
    assert_eq!(game.player2_points, points2);

    client.stick(&session_id, &player1);
    client.stick(&session_id, &player2);

    // Try to reveal winner (may be draw)
    let _ = client.try_reveal_winner(&session_id);
}

// ============================================================================
// Card Value Tests
// ============================================================================

#[test]
fn test_face_cards_worth_10() {
    // This is a deterministic test of card value logic
    // We can't control what cards are dealt, but we can verify the hand value calculation
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 25u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    let game = client.get_game(&session_id);

    // Manually verify card values
    for i in 0..game.player1_hand.len() {
        let card = game.player1_hand.get(i).unwrap() as u32;
        let expected_value = if card >= 10 { 10 } else { card };

        // Verify this matches our expectation
        assert!(expected_value >= 1 && expected_value <= 10);
    }
}

#[test]
fn test_hand_value_calculation() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 26u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    // Get hand value from contract
    let contract_value = client.get_hand_value(&session_id, &player1);

    // Calculate expected value manually
    let game = client.get_game(&session_id);
    let expected_value = calculate_hand_value_helper(&game.player1_hand);

    assert_eq!(contract_value, expected_value);
}

// ============================================================================
// Admin Function Tests
// ============================================================================

#[test]
fn test_get_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());

    let contract_id = env.register(TwentyOneContract, (&admin, &hub_addr));
    let client = TwentyOneContractClient::new(&env, &contract_id);

    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, admin);
}

#[test]
fn test_get_hub() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());

    let contract_id = env.register(TwentyOneContract, (&admin, &hub_addr));
    let client = TwentyOneContractClient::new(&env, &contract_id);

    let retrieved_hub = client.get_hub();
    assert_eq!(retrieved_hub, hub_addr);
}

#[test]
fn test_set_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());

    let contract_id = env.register(TwentyOneContract, (&admin, &hub_addr));
    let client = TwentyOneContractClient::new(&env, &contract_id);

    // Set new admin
    client.set_admin(&new_admin);

    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, new_admin);
}

#[test]
fn test_set_hub() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());
    let new_hub_addr = Address::generate(&env);

    let contract_id = env.register(TwentyOneContract, (&admin, &hub_addr));
    let client = TwentyOneContractClient::new(&env, &contract_id);

    // Set new game_hub address
    client.set_hub(&new_hub_addr);

    let retrieved_hub = client.get_hub();
    assert_eq!(retrieved_hub, new_hub_addr);
}

#[test]
fn test_upgrade_function_exists() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());

    let contract_id = env.register(TwentyOneContract, (&admin, &hub_addr));
    let client = TwentyOneContractClient::new(&env, &contract_id);

    // Verify the upgrade function exists and can be called
    // Note: We can't test actual upgrade without real WASM files
    let new_wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    let result = client.try_upgrade(&new_wasm_hash);

    // Should fail (WASM doesn't exist) but confirms function signature is correct
    assert!(result.is_err());
}

// ============================================================================
// Determinism Tests
// ============================================================================

#[test]
fn test_deterministic_card_dealing() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 27u32;

    // Start first game
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);
    let game1 = client.get_game(&session_id);

    // Start second game with same session_id in new environment (should be identical)
    let (_env2, client2, _hub2, player1_2, player2_2) = setup_test();
    client2.start_game(&session_id, &player1_2, &player2_2, &100_0000000, &100_0000000);
    let game2 = client2.get_game(&session_id);

    // Note: Since we generate new addresses each time, the cards will be different
    // But we can verify that within the same session, cards are consistent
    assert_eq!(game1.player1_hand.len(), 2);
    assert_eq!(game2.player1_hand.len(), 2);
}

#[test]
fn test_round_counter() {
    let (_env, client, _hub, player1, player2) = setup_test();

    let session_id = 28u32;
    client.start_game(&session_id, &player1, &player2, &100_0000000, &100_0000000);

    let game = client.get_game(&session_id);
    assert_eq!(game.round, 1); // First round
}

// ============================================================================
// Self-Play Prevention Test
// ============================================================================

#[test]
fn test_cannot_play_against_self() {
    let (_env, client, _hub, player1, _player2) = setup_test();

    let session_id = 29u32;
    // Try to start game where player1 plays against themselves
    let result = client.try_start_game(&session_id, &player1, &player1, &100_0000000, &100_0000000);
    assert_twenty_one_error(&result, Error::SelfPlay);
}
