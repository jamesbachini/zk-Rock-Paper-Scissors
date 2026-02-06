#![no_std]

//! # Twenty-One Game
//!
//! A two-player card game where players try to get as close to 21 as possible without going over.
//! Each player is dealt 2 cards and can choose to "hit" (draw another card) or "stick" (end their turn).
//! Cards are valued 1-13 where Ace=1, 2-10=face value, Jack/Queen/King=10.
//!
//! **Game Hub Integration:**
//! This game is Game Hub-aware and enforces all games to be played through the
//! Game Hub contract. Games cannot be started or completed without points involvement.

use soroban_sdk::{
    Address, Bytes, BytesN, Env, IntoVal, contract, contractclient, contracterror,
    contractimpl, contracttype, vec
};

// Import GameHub contract interface
// This allows us to call into the GameHub contract
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    AlreadyStuck = 3,
    GameAlreadyEnded = 4,
    PlayerBusted = 5,
    BothPlayersNotStuck = 6,
    OpponentNotStuck = 7,
    Draw = 8,
    SelfPlay = 9,
    RoundOverflow = 10,
    InvalidHandData = 11,
}

// ============================================================================
// Events (REMOVED)
// ============================================================================
//
// All events have been removed to avoid duplication with GameHub events.
// Game lifecycle is tracked through GameHub's GameStarted and GameEnded events.
// Game-specific state (hands, scores) can be queried via get_game().
//
// This keeps the event stream clean and makes GameHub the single source of
// truth for game lifecycle monitoring.

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    pub player1_hand: Bytes,  // Each byte represents a card (1-13)
    pub player2_hand: Bytes,  // Each byte represents a card (1-13)
    pub player1_stuck: bool,
    pub player2_stuck: bool,
    pub winner: Option<Address>,
    pub round: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
}

// ============================================================================
// Storage TTL Management
// ============================================================================
// TTL (Time To Live) ensures game data doesn't expire unexpectedly
// Games are stored in temporary storage with a minimum 30-day retention

/// TTL for game storage (30 days in ledgers, ~5 seconds per ledger)
/// 30 days = 30 * 24 * 60 * 60 / 5 = 518,400 ledgers
const GAME_TTL_LEDGERS: u32 = 518_400;

// ============================================================================
// Helper Functions
// ============================================================================

/// Convert card number to point value.
/// Cards 1-13 where: Ace=1, 2-10=face value, Jack/Queen/King=10
fn card_value(card: u32) -> u32 {
    if card >= 10 {
        10 // Jack (11), Queen (12), King (13) all worth 10
    } else {
        card // Ace (1) through 10 are face value
    }
}

/// Calculate the total value of a hand (stored as Bytes where each byte is a card 1-13)
fn calculate_hand_value(hand: &Bytes) -> Result<u32, Error> {
    let mut total = 0u32;
    for i in 0..hand.len() {
        let card = hand.get(i).ok_or(Error::InvalidHandData)? as u32;
        total = total
            .checked_add(card_value(card))
            .ok_or(Error::InvalidHandData)?;
    }
    Ok(total)
}

/// Deal a card (1-13) using deterministic PRNG
/// The seed is passed in (as Hash from keccak256)
fn deal_card(env: &Env, seed: BytesN<32>) -> u8 {
    env.prng().seed(seed.into());
    env.prng().gen_range::<u64>(1..=13) as u8
}

// ============================================================================
// Contract Definition
// ============================================================================

#[contract]
pub struct TwentyOneContract;

#[contractimpl]
impl TwentyOneContract {
    /// Initialize the contract with GameHub address and admin
    ///
    /// # Arguments
    /// * `admin` - Admin address (can upgrade contract)
    /// * `game_hub` - Address of the GameHub contract
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        // Store admin and GameHub address
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
    }

    /// Start a new game between two players with points.
    /// This creates a session in the Game Hub and locks points before starting the game.
    /// Each player is dealt 2 cards to start.
    ///
    /// **CRITICAL:** This method requires authorization from THIS contract (not players).
    /// The Game Hub will call `game_id.require_auth()` which checks this contract's address.
    ///
    /// # Arguments
    /// * `session_id` - Unique session identifier (u32)
    /// * `player1` - Address of first player
    /// * `player2` - Address of second player
    /// * `player1_points` - Points amount committed by player 1
    /// * `player2_points` - Points amount committed by player 2
    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        // Prevent self-play: Player 1 and Player 2 must be different
        if player1 == player2 {
            return Err(Error::SelfPlay);
        }

        // Require authentication from both players (they consent to committing points)
        player1.require_auth_for_args(vec![&env, session_id.into_val(&env), player1_points.into_val(&env)]);
        player2.require_auth_for_args(vec![&env, session_id.into_val(&env), player2_points.into_val(&env)]);

        // Get GameHub address
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");

        // Create GameHub client
        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        // Call the Game Hub to start the session and lock points
        // This requires THIS contract's authorization (env.current_contract_address())
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        // Generate deterministic seed for card dealing
        // Seed components (all deterministic and identical between sim/submit):
        // 1. Session ID - unique per game
        // 2. Player addresses - both players contribute
        //
        // Note: We do NOT include ledger sequence or timestamp because those differ
        // between simulation and submission.
        let mut seed_bytes = Bytes::new(&env);
        seed_bytes.append(&Bytes::from_array(&env, &session_id.to_be_bytes()));
        seed_bytes.append(&player1.to_string().to_bytes());
        seed_bytes.append(&player2.to_string().to_bytes());
        let base_seed = env.crypto().keccak256(&seed_bytes);

        // Deal initial hands (2 cards each)
        // Use different seeds for each card to ensure variety
        let mut player1_hand = Bytes::new(&env);
        let mut player2_hand = Bytes::new(&env);

        // Deal 2 cards to player1
        for i in 0..2 {
            let mut card_seed_bytes = Bytes::new(&env);
            card_seed_bytes.append(&Bytes::from(base_seed.clone()));
            card_seed_bytes.append(&Bytes::from_array(&env, &[i, 1])); // [card_index, player]
            let card_seed = env.crypto().keccak256(&card_seed_bytes);
            player1_hand.push_back(deal_card(&env, card_seed.into()));
        }

        // Deal 2 cards to player2
        for i in 0..2 {
            let mut card_seed_bytes = Bytes::new(&env);
            card_seed_bytes.append(&Bytes::from(base_seed.clone()));
            card_seed_bytes.append(&Bytes::from_array(&env, &[i, 2])); // [card_index, player]
            let card_seed = env.crypto().keccak256(&card_seed_bytes);
            player2_hand.push_back(deal_card(&env, card_seed.into()));
        }

        // Create game
        let game = Game {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            player1_hand,
            player2_hand,
            player1_stuck: false,
            player2_stuck: false,
            winner: None,
            round: 1,
        };

        // Store game in temporary storage with 30-day TTL
        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);

        // Set TTL to ensure game is retained for at least 30 days
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        // Event emitted by GameHub contract (GameStarted)

        Ok(())
    }

    /// Player draws another card ("hit").
    /// If the player's hand value exceeds 21, they bust and lose immediately.
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    /// * `player` - Address of the player drawing a card
    pub fn hit(env: Env, session_id: u32, player: Address) -> Result<(), Error> {
        player.require_auth();

        // Get game from temporary storage
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        // Check game is still active (no winner yet)
        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        // Check player hasn't stuck yet
        let is_player1 = player == game.player1;
        let is_player2 = player == game.player2;

        if !is_player1 && !is_player2 {
            return Err(Error::NotPlayer);
        }

        if is_player1 && game.player1_stuck {
            return Err(Error::AlreadyStuck);
        }

        if is_player2 && game.player2_stuck {
            return Err(Error::AlreadyStuck);
        }

        // Generate seed for new card based on current hand size
        let mut seed_bytes = Bytes::new(&env);
        seed_bytes.append(&Bytes::from_array(&env, &session_id.to_be_bytes()));
        seed_bytes.append(&player.to_string().to_bytes());

        let card_count = if is_player1 {
            game.player1_hand.len()
        } else {
            game.player2_hand.len()
        };

        seed_bytes.append(&Bytes::from_array(&env, &(card_count as u32).to_be_bytes()));
        seed_bytes.append(&Bytes::from_array(&env, &game.round.to_be_bytes()));

        let card_seed = env.crypto().keccak256(&seed_bytes);
        let new_card = deal_card(&env, card_seed.into());

        // Add card to player's hand
        if is_player1 {
            game.player1_hand.push_back(new_card);

            // Check if player busted
            let hand_value = calculate_hand_value(&game.player1_hand)?;
            if hand_value > 21 {
                // Player 1 busted, player 2 wins
                // Call GameHub FIRST (before setting winner)
                Self::end_game_with_hub(&env, session_id, false)?;

                // Only set winner AFTER GameHub succeeds
                game.winner = Some(game.player2.clone());
                env.storage().temporary().set(&key, &game);

                // Return Ok - caller should check game.winner to see if game ended
                return Ok(());
            }
        } else {
            game.player2_hand.push_back(new_card);

            // Check if player busted
            let hand_value = calculate_hand_value(&game.player2_hand)?;
            if hand_value > 21 {
                // Player 2 busted, player 1 wins
                // Call GameHub FIRST (before setting winner)
                Self::end_game_with_hub(&env, session_id, true)?;

                // Only set winner AFTER GameHub succeeds
                game.winner = Some(game.player1.clone());
                env.storage().temporary().set(&key, &game);

                // Return Ok - caller should check game.winner to see if game ended
                return Ok(());
            }
        }

        // Store updated game
        env.storage().temporary().set(&key, &game);

        Ok(())
    }

    /// Player chooses to stick (end their turn with current hand).
    /// If both players have stuck, the game can be revealed.
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    /// * `player` - Address of the player sticking
    pub fn stick(env: Env, session_id: u32, player: Address) -> Result<(), Error> {
        player.require_auth();

        // Get game from temporary storage
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        // Check game is still active (no winner yet)
        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        // Mark player as stuck
        if player == game.player1 {
            if game.player1_stuck {
                return Err(Error::AlreadyStuck);
            }
            game.player1_stuck = true;
        } else if player == game.player2 {
            if game.player2_stuck {
                return Err(Error::AlreadyStuck);
            }
            game.player2_stuck = true;
        } else {
            return Err(Error::NotPlayer);
        }

        // Store updated game
        env.storage().temporary().set(&key, &game);

        Ok(())
    }

    /// Reveal the winner of the game and submit outcome to GameHub.
    /// Can only be called after both players have stuck.
    /// This calculates hand values, determines the winner (closest to 21),
    /// and handles draws by dealing new hands.
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    ///
    /// # Returns
    /// * `Address` - Address of the winning player
    pub fn reveal_winner(env: Env, session_id: u32) -> Result<Address, Error> {
        // Get game from temporary storage
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        // Check if game already ended (has a winner)
        if let Some(winner) = &game.winner {
            return Ok(winner.clone());
        }

        // Check both players have stuck
        if !game.player1_stuck || !game.player2_stuck {
            return Err(Error::BothPlayersNotStuck);
        }

        // Calculate hand values
        let player1_value = calculate_hand_value(&game.player1_hand)?;
        let player2_value = calculate_hand_value(&game.player2_hand)?;

        // Determine winner (closest to 21 without going over)
        // Note: Bust conditions are already handled in hit(), so values should be <= 21
        let winner = if player1_value > player2_value {
            // Player 1 is closer to 21
            game.player1.clone()
        } else if player2_value > player1_value {
            // Player 2 is closer to 21
            game.player2.clone()
        } else {
            // Draw - deal new hands and continue
            game.round = game.round.checked_add(1).ok_or(Error::RoundOverflow)?;

            // Reset stuck flags
            game.player1_stuck = false;
            game.player2_stuck = false;

            // Clear hands
            game.player1_hand = Bytes::new(&env);
            game.player2_hand = Bytes::new(&env);

            // Deal new hands (2 cards each)
            let mut seed_bytes = Bytes::new(&env);
            seed_bytes.append(&Bytes::from_array(&env, &session_id.to_be_bytes()));
            seed_bytes.append(&game.player1.to_string().to_bytes());
            seed_bytes.append(&game.player2.to_string().to_bytes());
            seed_bytes.append(&Bytes::from_array(&env, &game.round.to_be_bytes()));
            let base_seed = env.crypto().keccak256(&seed_bytes);

            // Deal 2 cards to player1
            for i in 0..2 {
                let mut card_seed_bytes = Bytes::new(&env);
                card_seed_bytes.append(&Bytes::from(base_seed.clone()));
                card_seed_bytes.append(&Bytes::from_array(&env, &[i, 1])); // [card_index, player]
                let card_seed = env.crypto().keccak256(&card_seed_bytes);
                game.player1_hand.push_back(deal_card(&env, card_seed.into()));
            }

            // Deal 2 cards to player2
            for i in 0..2 {
                let mut card_seed_bytes = Bytes::new(&env);
                card_seed_bytes.append(&Bytes::from(base_seed.clone()));
                card_seed_bytes.append(&Bytes::from_array(&env, &[i, 2])); // [card_index, player]
                let card_seed = env.crypto().keccak256(&card_seed_bytes);
                game.player2_hand.push_back(deal_card(&env, card_seed.into()));
            }

            // Store updated game and return error to indicate draw
            env.storage().temporary().set(&key, &game);

            return Err(Error::Draw);
        };

        // Call GameHub FIRST (before setting winner)
        let player1_won = winner == game.player1;
        Self::end_game_with_hub(&env, session_id, player1_won)?;

        // Only update game with winner AFTER GameHub succeeds
        game.winner = Some(winner.clone());
        env.storage().temporary().set(&key, &game);

        Ok(winner)
    }

    /// Get game information.
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    ///
    /// # Returns
    /// * `Game` - The game state (includes hands and winner after game ends)
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    /// Get the current hand value for a player.
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    /// * `player` - Address of the player
    ///
    /// # Returns
    /// * `u32` - The total value of the player's hand
    pub fn get_hand_value(env: Env, session_id: u32, player: Address) -> Result<u32, Error> {
        let key = DataKey::Game(session_id);
        let game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if player == game.player1 {
            calculate_hand_value(&game.player1_hand)
        } else if player == game.player2 {
            calculate_hand_value(&game.player2_hand)
        } else {
            Err(Error::NotPlayer)
        }
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Helper to end game with the Game Hub
    fn end_game_with_hub(env: &Env, session_id: u32, player1_won: bool) -> Result<(), Error> {
        // Get GameHub address
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");

        // Create GameHub client
        let game_hub = GameHubClient::new(env, &game_hub_addr);

        // Call the Game Hub to end the session
        // This unlocks points and updates standings
        // Event emitted by the Game Hub contract (GameEnded)
        game_hub.end_game(&session_id, &player1_won);

        Ok(())
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    /// Get the current admin address
    ///
    /// # Returns
    /// * `Address` - The admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    /// Set a new admin address
    ///
    /// # Arguments
    /// * `new_admin` - The new admin address
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Get the current GameHub contract address
    ///
    /// # Returns
    /// * `Address` - The GameHub contract address
    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    /// Set a new GameHub contract address
    ///
    /// # Arguments
    /// * `new_hub` - The new GameHub contract address
    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    /// Update the contract WASM hash (upgrade contract)
    ///
    /// # Arguments
    /// * `new_wasm_hash` - The hash of the new WASM binary
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
