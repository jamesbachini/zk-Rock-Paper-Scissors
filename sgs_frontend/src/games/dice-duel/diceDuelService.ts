import { Client as DiceDuelClient, type Game } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES, MULTI_SIG_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract, TransactionBuilder, StrKey, xdr, Address, authorizeEntry } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';

type ClientOptions = contract.ClientOptions;

/**
 * Service for interacting with the DiceDuel game contract
 */
export class DiceDuelService {
  private baseClient: DiceDuelClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    // Base client for read-only operations
    this.baseClient = new DiceDuelClient({
      contractId: this.contractId,
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
  ): DiceDuelClient {
    const options: ClientOptions = {
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    };
    return new DiceDuelClient(options);
  }

  /**
   * Get game state
   * Returns null if game doesn't exist (instead of throwing)
   */
  async getGame(sessionId: number): Promise<Game | null> {
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
   * Start a new game (requires multi-sig authorization)
   * Note: This requires both players to sign the transaction
   */
  async startGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(player1, signer);
    const tx = await client.start_game({
      session_id: sessionId,
      player1,
      player2,
      player1_points: player1Points,
      player2_points: player2Points,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  /**
   * STEP 1 (Player 1): Prepare a start game transaction and export signed auth entry
   * - Creates transaction with Player 2 as the transaction source
   * - Simulates to get auth entries
   * - Player 1 signs their auth entry
   * - Returns ONLY Player 1's signed auth entry XDR (not full transaction)
   *
   * Uses extended TTL (60 minutes) for multi-sig flow to allow time for both players to sign
   *
   * Player 2 will later import this auth entry and rebuild the transaction
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
    // Step 1: Build transaction with Player 2 as the source (no signing capabilities needed yet)
    const buildClient = new DiceDuelClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2, // Player 2 is the transaction source
    });

    const tx = await buildClient.start_game({
      session_id: sessionId,
      player1,
      player2,
      player1_points: player1Points,
      player2_points: player2Points,
    }, DEFAULT_METHOD_OPTIONS);
    // NOTE: Contract methods automatically simulate - no need to call tx.simulate() again!
    console.log('[prepareStartGame] Transaction built and simulated, extracting auth entries');

    // Step 2: Extract Player 1's STUBBED auth entry from simulation
    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;
    console.log('[prepareStartGame] Found', authEntries.length, 'auth entries in simulation');

    // Find Player 1's stubbed auth entry
    let player1AuthEntry = null;

    console.log('[prepareStartGame] Looking for auth entry for Player 1:', player1);

    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      try {
        const entryAddress = entry.credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();

        console.log(`[prepareStartGame] Auth entry ${i} address:`, entryAddressString);

        // Compare string addresses instead of using .equals() which doesn't exist on ScAddress
        if (entryAddressString === player1) {
          player1AuthEntry = entry;
          console.log(`[prepareStartGame] Found Player 1 auth entry at index ${i}`);
          break;
        }
      } catch (err) {
        console.log(`[prepareStartGame] Auth entry ${i} doesn't have address credentials:`, err);
        continue;
      }
    }

    if (!player1AuthEntry) {
      throw new Error(`No auth entry found for Player 1 (${player1}). Found ${authEntries.length} auth entries in simulation - check console logs for details.`);
    }

    // Step 4: Calculate extended TTL for multi-sig flow
    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    // Step 5: Sign the auth entry using authorizeEntry helper
    // This properly handles the signature generation and auth entry reconstruction
    console.log('[prepareStartGame] Signing Player 1 auth entry with expiration:', validUntilLedgerSeq);

    if (!player1Signer.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    // Use authorizeEntry to handle the full signing process
    // This is the proper way to sign auth entries according to stellar-sdk
    const signedAuthEntry = await authorizeEntry(
      player1AuthEntry,  // The stubbed entry from simulation (with void signature)
      async (preimage) => {
        // The preimage is what needs to be signed
        // Call wallet to sign the preimage hash
        console.log('[prepareStartGame] Signing preimage with wallet...');

        if (!player1Signer.signAuthEntry) {
          throw new Error('Wallet does not support auth entry signing');
        }

        const signResult = await player1Signer.signAuthEntry(
          preimage.toXDR('base64'),  // Preimage as base64 XDR
          {
            networkPassphrase: NETWORK_PASSPHRASE,
            address: player1,
          }
        );

        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }

        console.log('[prepareStartGame] Got signature from wallet');

        // Return signature as Buffer (authorizeEntry expects a Buffer)
        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,  // Signature expiration ledger
      NETWORK_PASSPHRASE,
    );

    // authorizeEntry returns the fully reconstructed auth entry with the signature
    const signedAuthEntryXdr = signedAuthEntry.toXDR('base64');
    console.log('[prepareStartGame] ✅ Successfully signed and exported Player 1 auth entry XDR (length:', signedAuthEntryXdr.length, ')');
    return signedAuthEntryXdr;
  }

  /**
   * Parse a signed auth entry to extract game parameters
   *
   * Auth entries from require_auth_for_args only contain the args that player is authorizing:
   * - Player address (from credentials)
   * - Session ID (arg 0)
   * - Player's points (arg 1)
   */
  parseAuthEntry(authEntryXdr: string): {
    sessionId: number;
    player1: string;
    player1Points: bigint;
    functionName: string;
  } {
    try {
      // Parse the auth entry from XDR
      const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');

      console.log('[parseAuthEntry] Parsed auth entry from XDR');

      // Extract Player 1's address from credentials
      const credentials = authEntry.credentials();
      console.log('[parseAuthEntry] Credentials type:', credentials.switch().name);

      const addressCreds = credentials.address();
      const player1Address = addressCreds.address();
      const player1 = Address.fromScAddress(player1Address).toString();
      console.log('[parseAuthEntry] Player 1 address:', player1);

      // Get the root invocation
      const rootInvocation = authEntry.rootInvocation();
      console.log('[parseAuthEntry] Got root invocation');

      // Get the authorized function
      const authorizedFunction = rootInvocation.function();
      console.log('[parseAuthEntry] Authorized function type:', authorizedFunction.switch().name);

      // Extract the contract function invocation
      const contractFn = authorizedFunction.contractFn();
      console.log('[parseAuthEntry] Got contract function');

      // Get function name and args
      const functionName = contractFn.functionName().toString();
      console.log('[parseAuthEntry] Function name:', functionName);

      if (functionName !== 'start_game') {
        throw new Error(`Unexpected function: ${functionName}. Expected start_game.`);
      }

      // Extract arguments from the invocation
      // For start_game with require_auth_for_args, we have:
      // 0: session_id (u32)
      // 1: player_points (i128)
      const args = contractFn.args();
      console.log('[parseAuthEntry] Number of args:', args.length);

      if (args.length !== 2) {
        throw new Error(`Expected 2 arguments for start_game auth entry, got ${args.length}`);
      }

      const sessionId = args[0].u32();
      const player1Points = args[1].i128().lo().toBigInt();

      console.log('[parseAuthEntry] Extracted:', {
        sessionId,
        player1,
        player1Points: player1Points.toString(),
      });

      return {
        sessionId,
        player1,
        player1Points,
        functionName,
      };
    } catch (err: any) {
      console.error('[parseAuthEntry] Error parsing auth entry:', err);
      throw new Error(`Failed to parse auth entry: ${err.message}`);
    }
  }

  /**
   * STEP 2 (Player 2): Import Player 1's signed auth entry and rebuild transaction
   * - Parses Player 1's signed auth entry to extract game parameters
   * - Validates that the current user is Player 2
   * - Rebuilds the transaction with Player 2 as source
   * - Injects Player 1's signed auth entry (replacing the stub)
   * - Signs Player 2's auth entry if needed
   * - Returns full transaction XDR ready for finalizeStartGame
   *
   * Uses extended TTL (60 minutes) for multi-sig flow to allow time for both players to sign
   *
   * @param player1SignedAuthEntryXdr - The signed auth entry from Player 1
   * @param player2Address - Player 2's address (the importer, must match auth entry)
   * @param player2Points - The points amount Player 2 wants to set (for validation/override)
   * @param player2Signer - Player 2's signing capabilities
   * @param authTtlMinutes - Optional custom TTL (defaults to 60 minutes)
   */
  async importAndSignAuthEntry(
    player1SignedAuthEntryXdr: string,
    player2Address: string,
    player2Points: bigint,
    player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    console.log('[importAndSignAuthEntry] Parsing Player 1 signed auth entry...');

    // Parse the auth entry to extract game parameters
    const gameParams = this.parseAuthEntry(player1SignedAuthEntryXdr);

    console.log('[importAndSignAuthEntry] Parsed game parameters:', {
      sessionId: gameParams.sessionId,
      player1: gameParams.player1,
      player1Points: gameParams.player1Points.toString(),
    });

    console.log('[importAndSignAuthEntry] Rebuilding transaction with Player 2 params:', {
      player2: player2Address,
      player2Points: player2Points.toString(),
    });

    // Validation: Prevent self-play at service layer
    if (player2Address === gameParams.player1) {
      throw new Error('Cannot play against yourself. Player 2 must be different from Player 1.');
    }

    // Step 1: Build a new transaction with Player 2 as the source
    // Use parsed parameters from auth entry + provided Player 2 params
    const buildClient = new DiceDuelClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2Address, // Player 2 is the transaction source
    });

    const tx = await buildClient.start_game({
      session_id: gameParams.sessionId,
      player1: gameParams.player1,        // From auth entry
      player2: player2Address,             // Provided by Player 2
      player1_points: gameParams.player1Points, // From auth entry
      player2_points: player2Points,         // Provided by Player 2
    }, DEFAULT_METHOD_OPTIONS);
    // NOTE: Contract methods automatically simulate - no need to call tx.simulate() again!

    // Log simulation data to understand what we have
    console.log('[importAndSignAuthEntry] Transaction built and simulated');
    console.log('[importAndSignAuthEntry] Has simulation data:', !!tx.simulationData);
    console.log('[importAndSignAuthEntry] Has result:', !!tx.simulationData?.result);
    console.log('[importAndSignAuthEntry] Has auth entries:', !!tx.simulationData?.result?.auth);

    if (tx.simulationData?.result?.auth) {
      const authEntries = tx.simulationData.result.auth;
      console.log(`[importAndSignAuthEntry] Found ${authEntries.length} auth entries in simulation:`);
      for (let i = 0; i < authEntries.length; i++) {
        try {
          const entry = authEntries[i];
          const credentialType = entry.credentials().switch().name;

          if (credentialType === 'sorobanCredentialsAddress') {
            const entryAddress = entry.credentials().address().address();
            const entryAddressString = Address.fromScAddress(entryAddress).toString();
            const signatureType = entry.credentials().address().signature().switch().name;
            console.log(`  [${i}] ${entryAddressString} - signature: ${signatureType}`);
          } else {
            console.log(`  [${i}] ${credentialType}`);
          }
        } catch (err: any) {
          console.log(`  [${i}] Error reading entry:`, err.message);
        }
      }
    } else {
      console.log('[importAndSignAuthEntry] ⚠️ No auth entries in simulation data!');
    }
    console.log();

    // Step 2: Inject Player 1's signed auth entry (replacing the stub)
    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    const txWithInjectedAuth = await injectSignedAuthEntry(
      tx,
      player1SignedAuthEntryXdr,
      player2Address,
      player2Signer,
      validUntilLedgerSeq
    );
    console.log('[importAndSignAuthEntry] Injected Player 1 signed auth entry');

    // Step 4: Create a signing client and import the transaction
    const player2Client = this.createSigningClient(player2Address, player2Signer);
    const player2Tx = player2Client.txFromXDR(txWithInjectedAuth.toXDR());

    // Step 5: Check if Player 2 needs to sign an auth entry
    const needsSigning = await player2Tx.needsNonInvokerSigningBy();
    console.log('[importAndSignAuthEntry] Accounts that still need to sign auth entries:', needsSigning);

    // Player 2 signs their auth entry if they're in the needsSigning list
    if (needsSigning.includes(player2Address)) {
      console.log('[importAndSignAuthEntry] Signing Player 2 auth entry');
      await player2Tx.signAuthEntries({ expiration: validUntilLedgerSeq });
    }

    // Export full transaction XDR (with both auth entries signed)
    console.log('[importAndSignAuthEntry] Returning full transaction XDR ready for submission');
    return player2Tx.toXDR();
  }

  /**
   * STEP 3 (Player 1 or Player 2): Finalize and submit the transaction
   * - Imports the fully-signed XDR
   * - Re-simulates (REQUIRED after auth entries are signed)
   * - Signs transaction envelope and submits to network
   *
   * Can be called by either player, but typically Player 2 (the transaction source)
   */
  async finalizeStartGame(
    xdr: string,
    signerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(signerAddress, signer);

    // Import the transaction with all auth entries signed
    const tx = client.txFromXDR(xdr);

    // CRITICAL: Must simulate again after auth entries are signed
    // This updates the transaction with the signed auth entries
    await tx.simulate();

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

    // Sign the transaction envelope and submit
    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  /**
   * Helper: Check which signatures are still needed
   * Returns array of addresses that need to sign auth entries
   */
  async checkRequiredSignatures(
    xdr: string,
    publicKey: string
  ): Promise<string[]> {
    const client = this.createSigningClient(publicKey, {
      signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }),
      signAuthEntry: async (xdr: string) => ({ signedAuthEntry: xdr }),
    });

    const tx = client.txFromXDR(xdr);

    // Returns array of addresses that need to sign their auth entries
    const needsSigning = await tx.needsNonInvokerSigningBy();
    return needsSigning;
  }

  /**
   * Parse transaction XDR to extract game details
   * Returns session ID, player addresses, points, and transaction source
   * Uses proper SDK methods to extract contract invocation parameters
   */
  parseTransactionXDR(xdr: string): {
    sessionId: number;
    player1: string;
    player2: string;
    player1Points: bigint;
    player2Points: bigint;
    transactionSource: string;
    functionName: string;
  } {
    // Parse the XDR into a Transaction object
    const transaction = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);

    // Get the transaction source (only regular Transactions have .source, not FeeBumpTransactions)
    const transactionSource = 'source' in transaction ? transaction.source : '';

    // Get the first operation (should be invokeHostFunction for contract calls)
    const operation = transaction.operations[0];

    if (!operation || operation.type !== 'invokeHostFunction') {
      throw new Error('Transaction does not contain a contract invocation');
    }

    // Extract the contract invocation details
    const func = operation.func;
    const invokeContractArgs = func.invokeContract();

    // Get function name
    const functionName = invokeContractArgs.functionName().toString();

    // Get the arguments (ScVal array)
    const args = invokeContractArgs.args();

    // For start_game, the arguments are:
    // 0: session_id (u32)
    // 1: player1 (Address)
    // 2: player2 (Address)
    // 3: player1_points (i128)
    // 4: player2_points (i128)

    if (functionName !== 'start_game') {
      throw new Error(`Unexpected function: ${functionName}. Expected start_game.`);
    }

    if (args.length !== 5) {
      throw new Error(`Expected 5 arguments for start_game, got ${args.length}`);
    }

    // Extract session_id (u32)
    const sessionId = args[0].u32();

    // Extract player1 (Address)
    const player1ScVal = args[1];
    const player1Address = player1ScVal.address().accountId().ed25519();
    const player1 = StrKey.encodeEd25519PublicKey(player1Address);

    // Extract player2 (Address)
    const player2ScVal = args[2];
    const player2Address = player2ScVal.address().accountId().ed25519();
    const player2 = StrKey.encodeEd25519PublicKey(player2Address);

    // Extract points (i128)
    const player1PointsScVal = args[3];
    const player1Points = player1PointsScVal.i128().lo().toBigInt();

    const player2PointsScVal = args[4];
    const player2Points = player2PointsScVal.i128().lo().toBigInt();

    return {
      sessionId,
      player1,
      player2,
      player1Points,
      player2Points,
      transactionSource,
      functionName,
    };
  }

  /**
   * Commit a dice roll
   */
  async roll(
    sessionId: number,
    playerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(playerAddress, signer);
    const tx = await client.roll({
      session_id: sessionId,
      player: playerAddress,
    }, DEFAULT_METHOD_OPTIONS);
    // NOTE: Contract methods automatically simulate - footprint is already prepared

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

    try {
      const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);

      if (sentTx.getTransactionResponse?.status === 'FAILED') {
        const errorMessage = this.extractErrorFromDiagnostics(sentTx.getTransactionResponse);
        throw new Error(`Transaction failed: ${errorMessage}`);
      }

      return sentTx.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Transaction failed - check if the game is still active and you haven\'t already rolled');
      }
      throw err;
    }
  }

  /**
   * Reveal the winner after both players have rolled
   */
  async revealWinner(
    sessionId: number,
    callerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(callerAddress, signer);
    const tx = await client.reveal_winner({ session_id: sessionId }, DEFAULT_METHOD_OPTIONS);
    // NOTE: Contract methods automatically simulate - footprint already includes all required storage keys
    // (reveal_winner calls the Game Hub end_game() hook)

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

    try {
      const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds, validUntilLedgerSeq);

      // Check transaction status before accessing result
      if (sentTx.getTransactionResponse?.status === 'FAILED') {
        // Extract error from diagnostic events instead of return_value
        const errorMessage = this.extractErrorFromDiagnostics(sentTx.getTransactionResponse);
        throw new Error(`Transaction failed: ${errorMessage}`);
      }

      return sentTx.result;
    } catch (err) {
      // If we get here, either:
      // 1. The transaction failed and we couldn't parse the result (return_value is null)
      // 2. The transaction submission failed
      // 3. The transaction is still pending after timeout

      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        // This is the SDK error when trying to access .result on a failed transaction
        throw new Error('Transaction failed - check if both players have rolled and the game is still active');
      }

      throw err;
    }
  }

  /**
   * Extract human-readable error message from diagnostic events
   */
  private extractErrorFromDiagnostics(transactionResponse: any): string {
    try {
      // Log full response for debugging
      console.error('Transaction response:', JSON.stringify(transactionResponse, null, 2));

      const diagnosticEvents = transactionResponse?.diagnosticEventsXdr ||
                              transactionResponse?.diagnostic_events || [];

      // Look for error events in diagnostic events
      for (const event of diagnosticEvents) {
        if (event?.topics) {
          const topics = Array.isArray(event.topics) ? event.topics : [];

          // Check if this is an error event
          const hasErrorTopic = topics.some((topic: any) =>
            topic?.symbol === 'error' ||
            topic?.error
          );

          if (hasErrorTopic && event.data) {
            // Try to extract error message from data
            if (typeof event.data === 'string') {
              return event.data;
            } else if (event.data.vec && Array.isArray(event.data.vec)) {
              // Find string messages in the vec
              const messages = event.data.vec
                .filter((item: any) => item?.string)
                .map((item: any) => item.string);
              if (messages.length > 0) {
                return messages.join(': ');
              }
            }
          }
        }
      }

      // Check for result_xdr error info
      if (transactionResponse?.result_xdr) {
        console.error('Result XDR:', transactionResponse.result_xdr);
      }

      // Check for error in return value
      if (transactionResponse?.returnValue) {
        console.error('Return value:', transactionResponse.returnValue);
      }

      // Fallback: return status with more context
      const status = transactionResponse?.status || 'Unknown';
      return `Transaction ${status}. Check console for details.`;
    } catch (err) {
      console.error('Failed to extract error from diagnostics:', err);
      return 'Transaction failed with unknown error';
    }
  }
}

// Note: Create instances with a specific contract ID
// Example: const diceDuelService = new DiceDuelService(contractId);
