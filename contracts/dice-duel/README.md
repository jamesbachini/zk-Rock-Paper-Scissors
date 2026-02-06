# Dice Duel Game

A two-player dice game smart contract built on Stellar's Soroban platform.

## Overview

Each player commits to a roll. After both players have rolled, the contract
reveals two dice for each player and the highest total wins (ties go to Player 1).

## Features

- **Contract-Generated Dice**: Uses Soroban PRNG to generate dice values
- **Two-Player Games**: Each game involves exactly two players
- **Simple Rules**: Roll two dice each, highest total wins
- **Multiple Concurrent Games**: Support for multiple independent games
- **Game Hub Integration**: Uses `start_game` and `end_game` for points locking and results

## Contract Methods

### `start_game`
Start a new game between two players.

**Parameters:**
- `session_id: u32`
- `player1: Address`
- `player2: Address`
- `player1_points: i128`
- `player2_points: i128`

**Returns:** `Result<(), Error>`

**Auth:** Requires authentication from both players

### `roll`
Commit a roll for the current game.

**Parameters:**
- `session_id: u32`
- `player: Address`

**Returns:** `Result<(), Error>`

**Auth:** Requires authentication from the rolling player

### `reveal_winner`
Reveal the winner after both players have rolled.

**Parameters:**
- `session_id: u32`

**Returns:** `Result<Address, Error>` - Address of the winning player

**Note:** Can only be called after both players have rolled. If totals are equal,
Player 1 wins the tie.

### `get_game`
Get the current state of a game.

**Parameters:**
- `session_id: u32`

**Returns:** `Result<Game, Error>` - The game state

## Game Flow

1. Two players call `start_game` to create a new game
2. Each player calls `roll` to commit their roll
3. Once both players have rolled, anyone can call `reveal_winner`
4. The contract generates two dice for each player
5. The game is marked as ended and the winner is recorded

## Error Codes

- `GameNotFound` (1): The specified session does not exist
- `NotPlayer` (2): Caller is not a player in this game
- `AlreadyRolled` (3): Player already committed their roll
- `BothPlayersNotRolled` (4): Cannot reveal winner until both players roll
- `GameAlreadyEnded` (5): Game already ended

## Building

```bash
stellar contract build
```

Output: `target/wasm32v1-none/release/dice_duel.wasm`

## Testing

```bash
cargo test
```

## Technical Details

- **Deterministic PRNG**: Uses a deterministic seed so results are stable between
  simulation and submission.
- **Storage**: Uses temporary storage with a 30-day TTL.
