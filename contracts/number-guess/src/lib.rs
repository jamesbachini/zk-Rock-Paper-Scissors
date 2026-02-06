#![no_std]

//! # Number Guess Game
//!
//! A simple two-player guessing game where players guess a number between 1 and 10.
//! The player whose guess is closest to the randomly generated number wins.
//!
//! **Game Hub Integration:**
//! This game is Game Hub-aware and enforces all games to be played through the
//! Game Hub contract. Games cannot be started or completed without points involvement.

use soroban_sdk::{
    Address, Bytes, BytesN, Env, IntoVal, contract, contractclient, contracterror, contractimpl, contracttype, vec
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

    fn end_game(
        env: Env,
        session_id: u32,
        player1_won: bool
    );
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
    AlreadyGuessed = 3,
    BothPlayersNotGuessed = 4,
    GameAlreadyEnded = 5,
}

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
    pub player1_guess: Option<u32>,
    pub player2_guess: Option<u32>,
    pub winning_number: Option<u32>,
    pub winner: Option<Address>,
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
// Contract Definition
// ============================================================================

#[contract]
pub struct NumberGuessContract;

#[contractimpl]
impl NumberGuessContract {
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
            panic!("Cannot play against yourself: Player 1 and Player 2 must be different addresses");
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

        // Call Game Hub to start the session and lock points
        // This requires THIS contract's authorization (env.current_contract_address())
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        // Create game (winning_number not set yet - will be generated in reveal_winner)
        let game = Game {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            player1_guess: None,
            player2_guess: None,
            winning_number: None,
            winner: None,
        };

        // Store game in temporary storage with 30-day TTL
        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);

        // Set TTL to ensure game is retained for at least 30 days
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        // Event emitted by the Game Hub contract (GameStarted)

        Ok(())
    }

    /// Make a guess for the current game.
    /// Players can guess a number between 1 and 10.
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    /// * `player` - Address of the player making the guess
    /// * `guess` - The guessed number (1-10)
    pub fn make_guess(env: Env, session_id: u32, player: Address, guess: u32) -> Result<(), Error> {
        player.require_auth();

        // Validate guess is in range
        if guess < 1 || guess > 10 {
            panic!("Guess must be between 1 and 10");
        }

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

        // Update guess for the appropriate player
        if player == game.player1 {
            if game.player1_guess.is_some() {
                return Err(Error::AlreadyGuessed);
            }
            game.player1_guess = Some(guess);
        } else if player == game.player2 {
            if game.player2_guess.is_some() {
                return Err(Error::AlreadyGuessed);
            }
            game.player2_guess = Some(guess);
        } else {
            return Err(Error::NotPlayer);
        }

        // Store updated game in temporary storage
        env.storage().temporary().set(&key, &game);

        // No event emitted - game state can be queried via get_game()

        Ok(())
    }

    /// Reveal the winner of the game and submit outcome to GameHub.
    /// Can only be called after both players have made their guesses.
    /// This generates the winning number, determines the winner, and ends the session.
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

        // Check both players have guessed
        let guess1 = game.player1_guess.ok_or(Error::BothPlayersNotGuessed)?;
        let guess2 = game.player2_guess.ok_or(Error::BothPlayersNotGuessed)?;

        // Generate random winning number between 1 and 10 using seeded PRNG
        // This is done AFTER both players have committed their guesses
        //
        // Seed components (all deterministic and identical between sim/submit):
        // 1. Session ID - unique per game, same between simulation and submission
        // 2. Player addresses - both players contribute, same between sim/submit
        // 3. Guesses - committed before reveal, same between sim/submit
        //
        // Note: We do NOT include ledger sequence or timestamp because those differ
        // between simulation and submission, which would cause different winners.
        //
        // This ensures:
        // - Same result between simulation and submission (fully deterministic)
        // - Cannot be easily gamed (both players contribute to randomness)

        // Build seed more efficiently using native arrays where possible
        // Total: 12 bytes of fixed data (session_id + 2 guesses)
        let mut fixed_data = [0u8; 12];
        fixed_data[0..4].copy_from_slice(&session_id.to_be_bytes());
        fixed_data[4..8].copy_from_slice(&guess1.to_be_bytes());
        fixed_data[8..12].copy_from_slice(&guess2.to_be_bytes());

        // Only use Bytes for the final concatenation with player addresses
        let mut seed_bytes = Bytes::from_array(&env, &fixed_data);
        seed_bytes.append(&game.player1.to_string().to_bytes());
        seed_bytes.append(&game.player2.to_string().to_bytes());

        let seed = env.crypto().keccak256(&seed_bytes);
        env.prng().seed(seed.into());
        let winning_number = env.prng().gen_range::<u64>(1..=10) as u32;
        game.winning_number = Some(winning_number);

        // Calculate distances
        let distance1 = if guess1 > winning_number {
            guess1 - winning_number
        } else {
            winning_number - guess1
        };

        let distance2 = if guess2 > winning_number {
            guess2 - winning_number
        } else {
            winning_number - guess2
        };

        // Determine winner (if equal distance, player1 wins)
        let winner = if distance1 <= distance2 {
            game.player1.clone()
        } else {
            game.player2.clone()
        };

        // Update game with winner (this marks the game as ended)
        game.winner = Some(winner.clone());
        env.storage().temporary().set(&key, &game);

        // Get GameHub address
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");

        // Create GameHub client
        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        // Call GameHub to end the session
        // This unlocks points and updates standings
        // Event emitted by the Game Hub contract (GameEnded)
        let player1_won = winner == game.player1; // true if player1 won, false if player2 won
        game_hub.end_game(&session_id, &player1_won);

        Ok(winner)
    }

    /// Get game information.
    ///
    /// # Arguments
    /// * `session_id` - The session ID of the game
    ///
    /// # Returns
    /// * `Game` - The game state (includes winning number after game ends)
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
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
