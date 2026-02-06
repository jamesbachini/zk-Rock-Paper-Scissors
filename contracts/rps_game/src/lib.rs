#![no_std]

//! # RPS Game (Ultrahonk Reveal)
//!
//! Two-player Rock/Paper/Scissors with commit/reveal deadlines and GameHub lifecycle
//! integration. Reveals are validated by an on-chain Ultrahonk verifier contract.

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, vec,
    Address, Bytes, BytesN, Env, IntoVal, InvokeError, Symbol,
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
    AlreadyInitialized = 1,
    NotInitialized = 2,
    SessionAlreadyExists = 3,
    SessionNotFound = 4,
    NotPlayer = 5,
    CommitWindowClosed = 6,
    RevealWindowClosed = 7,
    AlreadyCommitted = 8,
    AlreadyRevealed = 9,
    CommitRequired = 10,
    InvalidMove = 11,
    AlreadyFinalized = 12,
    FinalizeNotReady = 13,
    InvalidState = 14,
    SamePlayer = 15,
    InvalidPublicInputs = 16,
    ProofVerificationFailed = 17,
    CommitmentMismatch = 18,
}

// ============================================================================
// Data Types
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub game_hub: Address,
    pub verifier: Address,
    pub commit_window: u32,
    pub reveal_window: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionData {
    pub player1: Address,
    pub player2: Address,
    pub created_ledger: u32,
    pub commit_deadline_ledger: u32,
    pub reveal_deadline_ledger: u32,
    pub commit_p1: Option<BytesN<32>>,
    pub commit_p2: Option<BytesN<32>>,
    pub move_p1: Option<u32>,
    pub move_p2: Option<u32>,
    pub finalized: bool,
    pub winner: Option<u32>, // 0 = tie, 1 = player1, 2 = player2
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Session(u32),
}

// ============================================================================
// Events
// ============================================================================

#[contractevent]
pub struct SessionCreated {
    pub session_id: u32,
    pub player1: Address,
    pub player2: Address,
}

#[contractevent]
pub struct MoveCommitted {
    pub session_id: u32,
    pub player: Address,
}

#[contractevent]
pub struct MoveRevealed {
    pub session_id: u32,
    pub player: Address,
    pub move_: u32,
}

#[contractevent]
pub struct Finalized {
    pub session_id: u32,
    pub winner: u32,
}

// ============================================================================
// Storage TTL Management
// ============================================================================
// TTL (Time To Live) ensures session data doesn't expire unexpectedly
// Sessions are stored in temporary storage with a minimum 30-day retention

/// TTL for session storage (30 days in ledgers, ~5 seconds per ledger)
/// 30 days = 30 * 24 * 60 * 60 / 5 = 518,400 ledgers
const SESSION_TTL_LEDGERS: u32 = 518_400;
const PUBLIC_INPUTS_FIELDS: u32 = 2;
const FIELD_BYTES: u32 = 32;
const PUBLIC_INPUTS_LEN: u32 = PUBLIC_INPUTS_FIELDS * FIELD_BYTES;

// ============================================================================
// Helper Functions
// ============================================================================

fn get_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn load_session(env: &Env, session_id: u32) -> Result<SessionData, Error> {
    env.storage()
        .temporary()
        .get(&DataKey::Session(session_id))
        .ok_or(Error::SessionNotFound)
}

fn save_session(env: &Env, session_id: u32, session: &SessionData) {
    let key = DataKey::Session(session_id);
    env.storage().temporary().set(&key, session);
    env.storage()
        .temporary()
        .extend_ttl(&key, SESSION_TTL_LEDGERS, SESSION_TTL_LEDGERS);
}

fn is_player1(session: &SessionData, player: &Address) -> Result<bool, Error> {
    if *player == session.player1 {
        Ok(true)
    } else if *player == session.player2 {
        Ok(false)
    } else {
        Err(Error::NotPlayer)
    }
}

fn validate_move(mov: u32) -> Result<(), Error> {
    if mov <= 2 {
        Ok(())
    } else {
        Err(Error::InvalidMove)
    }
}

fn determine_winner(p1: u32, p2: u32) -> u32 {
    if p1 == p2 {
        0
    } else if (p1 == 0 && p2 == 2) || (p1 == 1 && p2 == 0) || (p1 == 2 && p2 == 1) {
        1
    } else {
        2
    }
}

fn parse_move_from_field(bytes: &Bytes) -> Result<u32, Error> {
    if bytes.len() != FIELD_BYTES {
        return Err(Error::InvalidPublicInputs);
    }

    // Field elements are 32-byte big-endian. Moves must fit in a u32.
    for i in 0..(FIELD_BYTES - 4) {
        if bytes.get_unchecked(i) != 0 {
            return Err(Error::InvalidPublicInputs);
        }
    }

    let b0 = bytes.get_unchecked(FIELD_BYTES - 4);
    let b1 = bytes.get_unchecked(FIELD_BYTES - 3);
    let b2 = bytes.get_unchecked(FIELD_BYTES - 2);
    let b3 = bytes.get_unchecked(FIELD_BYTES - 1);

    Ok(u32::from_be_bytes([b0, b1, b2, b3]))
}

fn parse_public_inputs(public_inputs: &Bytes) -> Result<(BytesN<32>, u32), Error> {
    if public_inputs.len() != PUBLIC_INPUTS_LEN {
        return Err(Error::InvalidPublicInputs);
    }

    let commitment_bytes = public_inputs.slice(0..FIELD_BYTES);
    let move_bytes = public_inputs.slice(FIELD_BYTES..PUBLIC_INPUTS_LEN);

    let commitment: BytesN<32> = commitment_bytes
        .try_into()
        .map_err(|_| Error::InvalidPublicInputs)?;
    let mov = parse_move_from_field(&move_bytes)?;

    Ok((commitment, mov))
}

fn verify_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: Bytes,
    proof_bytes: Bytes,
) -> Result<(), Error> {
    let args = vec![env, public_inputs.into_val(env), proof_bytes.into_val(env)];
    let func = Symbol::new(env, "verify_proof");
    let result = env.try_invoke_contract::<(), InvokeError>(verifier, &func, args);

    match result {
        Ok(Ok(())) => Ok(()),
        _ => Err(Error::ProofVerificationFailed),
    }
}

// ============================================================================
// Contract Definition
// ============================================================================

#[contract]
pub struct RpsGameContract;

#[contractimpl]
impl RpsGameContract {
    /// One-time initialization. Stores GameHub + verifier addresses and timing windows.
    pub fn init(
        env: Env,
        game_hub: Address,
        verifier: Address,
        commit_window: u32,
        reveal_window: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }

        let config = Config {
            game_hub,
            verifier,
            commit_window,
            reveal_window,
        };

        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    /// Create a new session between two players and call GameHub.start_game.
    pub fn create_session(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
    ) -> Result<(), Error> {
        let config = get_config(&env)?;

        if player1 == player2 {
            return Err(Error::SamePlayer);
        }

        if env
            .storage()
            .temporary()
            .has(&DataKey::Session(session_id))
        {
            return Err(Error::SessionAlreadyExists);
        }

        // Require both players to authorize zero points for the GameHub start.
        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            0i128.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            0i128.into_val(&env),
        ]);

        // Call GameHub to start the session before storing state.
        let game_hub = GameHubClient::new(&env, &config.game_hub);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &0i128,
            &0i128,
        );

        let now = env.ledger().sequence();
        let commit_deadline = now + config.commit_window;
        let reveal_deadline = commit_deadline + config.reveal_window;

        let session = SessionData {
            player1: player1.clone(),
            player2: player2.clone(),
            created_ledger: now,
            commit_deadline_ledger: commit_deadline,
            reveal_deadline_ledger: reveal_deadline,
            commit_p1: None,
            commit_p2: None,
            move_p1: None,
            move_p2: None,
            finalized: false,
            winner: None,
        };

        save_session(&env, session_id, &session);

        SessionCreated {
            session_id,
            player1,
            player2,
        }
        .publish(&env);

        Ok(())
    }

    /// Commit a move hash for the player.
    pub fn commit_move(
        env: Env,
        session_id: u32,
        player: Address,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        get_config(&env)?;
        player.require_auth();

        let mut session = load_session(&env, session_id)?;
        if session.finalized {
            return Err(Error::AlreadyFinalized);
        }

        let now = env.ledger().sequence();
        if now > session.commit_deadline_ledger {
            return Err(Error::CommitWindowClosed);
        }

        let is_p1 = is_player1(&session, &player)?;
        if is_p1 {
            if session.commit_p1.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            session.commit_p1 = Some(commitment);
        } else {
            if session.commit_p2.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            session.commit_p2 = Some(commitment);
        }

        save_session(&env, session_id, &session);
        MoveCommitted { session_id, player }.publish(&env);

        Ok(())
    }

    /// Reveal a move by submitting an Ultrahonk proof and public inputs.
    pub fn reveal_move(
        env: Env,
        session_id: u32,
        player: Address,
        proof: Bytes,
        public_inputs: Bytes,
    ) -> Result<(), Error> {
        let config = get_config(&env)?;
        player.require_auth();

        let mut session = load_session(&env, session_id)?;
        if session.finalized {
            return Err(Error::AlreadyFinalized);
        }

        let now = env.ledger().sequence();
        if now > session.reveal_deadline_ledger {
            return Err(Error::RevealWindowClosed);
        }

        let is_p1 = is_player1(&session, &player)?;
        let commitment = if is_p1 {
            if session.move_p1.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            session.commit_p1.clone().ok_or(Error::CommitRequired)?
        } else {
            if session.move_p2.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            session.commit_p2.clone().ok_or(Error::CommitRequired)?
        };

        let (commitment_public, mov) = parse_public_inputs(&public_inputs)?;
        validate_move(mov)?;
        if commitment_public != commitment {
            return Err(Error::CommitmentMismatch);
        }

        verify_proof(&env, &config.verifier, public_inputs, proof)?;

        if is_p1 {
            session.move_p1 = Some(mov);
        } else {
            session.move_p2 = Some(mov);
        }

        save_session(&env, session_id, &session);
        MoveRevealed {
            session_id,
            player,
            move_: mov,
        }
        .publish(&env);

        Ok(())
    }

    /// Finalize the session based on reveals or forfeit deadlines.
    pub fn finalize(env: Env, session_id: u32) -> Result<(), Error> {
        let config = get_config(&env)?;
        let mut session = load_session(&env, session_id)?;

        if session.finalized {
            return Err(Error::AlreadyFinalized);
        }

        let now = env.ledger().sequence();
        let p1_committed = session.commit_p1.is_some();
        let p2_committed = session.commit_p2.is_some();
        let p1_revealed = session.move_p1.is_some();
        let p2_revealed = session.move_p2.is_some();

        let winner = if p1_revealed && p2_revealed {
            let move_p1 = match session.move_p1 {
                Some(value) => value,
                None => return Err(Error::InvalidState),
            };
            let move_p2 = match session.move_p2 {
                Some(value) => value,
                None => return Err(Error::InvalidState),
            };
            determine_winner(move_p1, move_p2)
        } else if now > session.commit_deadline_ledger && (p1_committed ^ p2_committed) {
            if p1_committed {
                1
            } else {
                2
            }
        } else if now > session.reveal_deadline_ledger {
            if p1_revealed ^ p2_revealed {
                if p1_revealed {
                    1
                } else {
                    2
                }
            } else {
                0
            }
        } else {
            return Err(Error::FinalizeNotReady);
        };

        let player1_won = winner == 1;
        let game_hub = GameHubClient::new(&env, &config.game_hub);
        game_hub.end_game(&session_id, &player1_won);

        session.finalized = true;
        session.winner = Some(winner);
        save_session(&env, session_id, &session);

        Finalized { session_id, winner }.publish(&env);
        Ok(())
    }

    /// Get the session state (for UI polling).
    pub fn get_session(env: Env, session_id: u32) -> Result<SessionData, Error> {
        get_config(&env)?;
        load_session(&env, session_id)
    }

    /// Read-only helper to fetch a player's commitment (if any).
    pub fn get_commitment(
        env: Env,
        session_id: u32,
        player: Address,
    ) -> Result<Option<BytesN<32>>, Error> {
        get_config(&env)?;
        let session = load_session(&env, session_id)?;
        let is_p1 = is_player1(&session, &player)?;
        Ok(if is_p1 {
            session.commit_p1
        } else {
            session.commit_p2
        })
    }

    /// Read-only helper to fetch a player's revealed move (if any).
    pub fn get_move(env: Env, session_id: u32, player: Address) -> Result<Option<u32>, Error> {
        get_config(&env)?;
        let session = load_session(&env, session_id)?;
        let is_p1 = is_player1(&session, &player)?;
        Ok(if is_p1 {
            session.move_p1
        } else {
            session.move_p2
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
