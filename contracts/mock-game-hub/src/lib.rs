#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, Address, Env};

/// Mock Game Hub contract for game studio development
///
/// This contract provides the same external interface that games expect
/// (start_game, end_game) but does nothing internally. It exists purely
/// for game contracts to compile and integrate during development.
#[contract]
pub struct MockGameHub;

#[contractevent]
pub struct GameStarted {
    pub session_id: u32,
    pub game_id: Address,
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
}

#[contractevent]
pub struct GameEnded {
    pub session_id: u32,
    pub player1_won: bool,
}

#[contractimpl]
impl MockGameHub {
    /// Start a game session
    ///
    /// # Arguments
    /// * `game_id` - Address of the game contract calling this method
    /// * `session_id` - Unique identifier for this game session
    /// * `player1` - Address of first player
    /// * `player2` - Address of second player
    /// * `player1_points` - Points amount for player 1 (ignored in mock)
    /// * `player2_points` - Points amount for player 2 (ignored in mock)
    pub fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) {
        // No auth required for mock
        GameStarted {
            session_id,
            game_id,
            player1,
            player2,
            player1_points,
            player2_points,
        }
        .publish(&env);
        // bump instance ttl if required
        env.storage().instance().extend_ttl(17_280, 518_400);
    }

    /// End a game session and declare winner
    ///
    /// # Arguments
    /// * `session_id` - The game session being ended
    /// * `player1_won` - True if player1 won, false if player2 won
    pub fn end_game(
        env: Env,
        session_id: u32,
        player1_won: bool,
    ) {
        // No auth required for mock
        GameEnded {
            session_id,
            player1_won,
        }
        .publish(&env);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    #[test]
    fn test_start_and_end_game() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MockGameHub);
        let client = MockGameHubClient::new(&env, &contract_id);
        let game_id = Address::generate(&env);
        let player1 = Address::generate(&env);
        let player2 = Address::generate(&env);
        client.start_game(&game_id, &1, &player1, &player2, &1000, &1000);
        client.end_game(&1, &true);
    }
}
