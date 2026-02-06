import { Client as TwentyOneClient } from './bindings';
import { TWENTY_ONE_CONTRACT, NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES, MULTI_SIG_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract, Address, authorizeEntry, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';

type ClientOptions = contract.ClientOptions;

/**
 * Service for interacting with the Twenty-One game contract
 */
export class TwentyOneService {
  private baseClient: TwentyOneClient;

  constructor() {
    // Base client for read-only operations
    this.baseClient = new TwentyOneClient({
      contractId: TWENTY_ONE_CONTRACT,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  /**
   * Create a client with signing capabilities
   */
  private createSigningClient(
    publicKey: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): TwentyOneClient {
    const options: ClientOptions = {
      contractId: TWENTY_ONE_CONTRACT,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    };
    return new TwentyOneClient(options);
  }

  /**
   * Get game state
   * Returns null if game doesn't exist (instead of throwing)
   */
  async getGame(sessionId: number): Promise<any | null> {
    try {
      const tx = await this.baseClient.get_game({ session_id: sessionId });
      const result = await tx.simulate();

      // Check if result is Ok before unwrapping
      if (result.result.isOk()) {
        return result.result.unwrap();
      } else {
        // Game doesn't exist or contract returned error
        console.log('[getGame] Game not found for session:', sessionId);
        return null;
      }
    } catch (err) {
      // Simulation or contract call failed
      console.log('[getGame] Error querying game:', err);
      return null;
    }
  }

  /**
   * Get hand value for a player
   */
  async getHandValue(sessionId: number, player: string): Promise<number | null> {
    try {
      const tx = await this.baseClient.get_hand_value({
        session_id: sessionId,
        player
      });
      const result = await tx.simulate();

      if (result.result.isOk()) {
        return result.result.unwrap();
      } else {
        console.log('[getHandValue] Error getting hand value');
        return null;
      }
    } catch (err) {
      console.log('[getHandValue] Error:', err);
      return null;
    }
  }

  /**
   * STEP 1 (Player 1): Prepare a start game transaction and export signed auth entry
   * Uses extended TTL (60 minutes) for multi-sig flow
   */
  async prepareStartGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    player1Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    // Build transaction with Player 2 as the source
    const buildClient = new TwentyOneClient({
      contractId: TWENTY_ONE_CONTRACT,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });

    const tx = await buildClient.start_game({
      session_id: sessionId,
      player1,
      player2,
      player1_points: player1Points,
      player2_points: player2Points,
    }, DEFAULT_METHOD_OPTIONS);

    console.log('[prepareStartGame] Transaction built and simulated');

    // Extract Player 1's auth entry from simulation
    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;
    console.log('[prepareStartGame] Found', authEntries.length, 'auth entries');

    // Find Player 1's stubbed auth entry
    let player1AuthEntry = null;

    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      try {
        const credentialType = entry.credentials().switch().name;
        if (credentialType !== 'sorobanCredentialsAddress') {
          continue;
        }

        const entryAddress = entry.credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();

        if (entryAddressString === player1) {
          player1AuthEntry = entry;
          console.log(`[prepareStartGame] Found Player 1 auth entry at index ${i}`);
          break;
        }
      } catch (err) {
        continue;
      }
    }

    if (!player1AuthEntry) {
      throw new Error(`No auth entry found for Player 1 (${player1})`);
    }

    // Calculate TTL for multi-sig flow
    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    // Sign the auth entry
    console.log('[prepareStartGame] Signing Player 1 auth entry');

    if (!player1Signer.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    const signedAuthEntry = await authorizeEntry(
      player1AuthEntry,
      async (preimage) => {
        console.log('[prepareStartGame] Signing preimage with wallet...');

        if (!player1Signer.signAuthEntry) {
          throw new Error('Wallet does not support auth entry signing');
        }

        const signResult = await player1Signer.signAuthEntry(
          preimage.toXDR('base64'),
          {
            networkPassphrase: NETWORK_PASSPHRASE,
            address: player1,
          }
        );

        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }

        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE
    );

    // Return signed auth entry as base64 XDR
    const authEntryXDR = signedAuthEntry.toXDR('base64');
    console.log('[prepareStartGame] Player 1 signed auth entry:', authEntryXDR.slice(0, 50) + '...');

    return authEntryXDR;
  }

  /**
   * STEP 2 (Player 2): Import Player 1's auth entry and complete the transaction
   */
  async importAndSignAuthEntry(
    player1AuthEntryXDR: string,
    player2: string,
    player2Points: bigint,
    player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<string> {
    // Parse the auth entry to extract game parameters
    const gameParams = this.parseAuthEntry(player1AuthEntryXDR);

    // Rebuild the transaction with Player 2 as source
    const client = new TwentyOneClient({
      contractId: TWENTY_ONE_CONTRACT,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });

    const tx = await client.start_game({
      session_id: gameParams.sessionId,
      player1: gameParams.player1,
      player2,
      player1_points: gameParams.player1Points,
      player2_points: player2Points,
    }, DEFAULT_METHOD_OPTIONS);

    // Import Player 1's signed auth entry
    const { injectSignedAuthEntry } = await import('@/utils/authEntryUtils');
    const updatedTx = await injectSignedAuthEntry(tx, player1AuthEntryXDR, player2, player2Signer);

    return updatedTx.toXDR();
  }

  /**
   * STEP 3 (Player 2): Finalize and submit the fully signed transaction
   */
  async finalizeStartGame(
    fullySignedTxXDR: string,
    player2: string,
    player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player2, player2Signer);

    // Import the transaction with all auth entries signed
    const tx = client.txFromXDR(fullySignedTxXDR);

    // Must simulate again after auth entries are injected/signed
    await tx.simulate();

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  /**
   * Parse auth entry XDR to extract game parameters
   */
  parseAuthEntry(authEntryXDR: string): {
    sessionId: number;
    player1: string;
    player1Points: bigint;
  } {
    try {
      const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXDR, 'base64');

      // Auth entries from `require_auth_for_args` only contain the args the signer authorized:
      // - signer address (from credentials)
      // - session_id (arg 0)
      // - signer points (arg 1)
      const credentials = authEntry.credentials();
      if (credentials.switch().name !== 'sorobanCredentialsAddress') {
        throw new Error(`Unsupported credentials type: ${credentials.switch().name}`);
      }

      const player1 = Address.fromScAddress(credentials.address().address()).toString();

      const rootInvocation = authEntry.rootInvocation();
      const contractFn = rootInvocation.function().contractFn();
      const functionName = contractFn.functionName().toString();

      if (functionName !== 'start_game') {
        throw new Error(`Invalid function name: ${functionName}. Expected start_game`);
      }

      const args = contractFn.args();
      if (args.length !== 2) {
        throw new Error(`Invalid number of arguments: ${args.length}. Expected 2`);
      }

      const sessionId = args[0].u32();
      const player1Points = args[1].i128().lo().toBigInt();

      return {
        sessionId,
        player1,
        player1Points,
      };
    } catch (err) {
      console.error('[parseAuthEntry] Error parsing auth entry:', err);
      throw new Error(`Failed to parse auth entry: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  /**
   * Player hits (draws a card)
   */
  async hit(
    sessionId: number,
    player: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.hit({
      session_id: sessionId,
      player,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  /**
   * Player sticks (ends their turn)
   */
  async stick(
    sessionId: number,
    player: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.stick({
      session_id: sessionId,
      player,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  /**
   * Reveal the winner (can be called by either player)
   */
  async revealWinner(
    sessionId: number,
    player: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.reveal_winner({
      session_id: sessionId,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }
}

// Export singleton instance
export const twentyOneService = new TwentyOneService();
