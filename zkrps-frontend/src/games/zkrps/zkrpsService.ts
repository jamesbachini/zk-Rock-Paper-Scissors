import { Client as RpsClient, type SessionData } from './bindings';
import {
  NETWORK_PASSPHRASE,
  RPC_URL,
  DEFAULT_METHOD_OPTIONS,
  DEFAULT_AUTH_TTL_MINUTES,
  MULTI_SIG_AUTH_TTL_MINUTES,
} from '@/utils/constants';
import { contract, xdr, Address, authorizeEntry, rpc } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';

type ClientOptions = contract.ClientOptions;

/**
 * Service for interacting with the RPS game contract
 */
export class ZkrpsService {
  private baseClient: RpsClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new RpsClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): RpsClient {
    const options: ClientOptions = {
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    };
    return new RpsClient(options);
  }

  private async simulateWithBudgetLeeway<T>(
    tx: contract.AssembledTransaction<T>,
    label: string
  ): Promise<contract.AssembledTransaction<T>> {
    if (!tx.raw) {
      throw new Error(`${label}: transaction is missing the raw builder`);
    }

    const server = new rpc.Server(RPC_URL);
    const built = tx.raw.build();
    const leeways = [0, 50_000_000, 100_000_000, 200_000_000];
    let lastError: string | null = null;

    for (const cpuInstructions of leeways) {
      const sim = await server.simulateTransaction(
        built,
        cpuInstructions > 0 ? { cpuInstructions } : undefined
      );

      if (rpc.Api.isSimulationError(sim)) {
        lastError = sim.error;
        if (sim.error?.includes('Budget') || sim.error?.includes('ExceededLimit')) {
          continue;
        }
        throw new Error(sim.error);
      }

      if (rpc.Api.isSimulationRestore(sim)) {
        throw new Error(
          `${label}: contract state requires restore before invoking this method`
        );
      }

      tx.simulation = sim as any;
      tx.built = rpc.assembleTransaction(built, sim).build();
      return tx;
    }

    throw new Error(lastError ?? `${label}: simulation failed`);
  }

  async getSession(sessionId: number): Promise<SessionData | null> {
    try {
      const tx = await this.baseClient.get_session({ session_id: sessionId });
      const result = await tx.simulate();

      if (result.result.isOk()) {
        return result.result.unwrap();
      }

      return null;
    } catch (err) {
      console.log('[getSession] Error querying session:', err);
      return null;
    }
  }

  async getCommitment(sessionId: number, player: string): Promise<Buffer | null> {
    try {
      const tx = await this.baseClient.get_commitment({ session_id: sessionId, player });
      const result = await tx.simulate();

      if (result.result.isOk()) {
        return result.result.unwrap() ?? null;
      }

      return null;
    } catch (err) {
      console.log('[getCommitment] Error querying commitment:', err);
      return null;
    }
  }

  async getMove(sessionId: number, player: string): Promise<number | null> {
    try {
      const tx = await this.baseClient.get_move({ session_id: sessionId, player });
      const result = await tx.simulate();

      if (result.result.isOk()) {
        return result.result.unwrap() ?? null;
      }

      return null;
    } catch (err) {
      console.log('[getMove] Error querying move:', err);
      return null;
    }
  }

  async prepareCreateSession(
    sessionId: number,
    player1: string,
    player2: string,
    player1Signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    const buildClient = new RpsClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });

    const tx = await buildClient.create_session({
      session_id: sessionId,
      player1,
      player2,
    }, DEFAULT_METHOD_OPTIONS);

    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;

    let player1AuthEntry: xdr.SorobanAuthorizationEntry | null = null;
    for (const entry of authEntries) {
      try {
        const entryAddress = entry.credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();
        if (entryAddressString === player1) {
          player1AuthEntry = entry;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!player1AuthEntry) {
      throw new Error(`No auth entry found for Player 1 (${player1}).`);
    }

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    if (!player1Signer.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    const signedAuthEntry = await authorizeEntry(
      player1AuthEntry,
      async (preimage) => {
        const signResult = await player1Signer.signAuthEntry(preimage.toXDR('base64'), {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: player1,
        });

        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }

        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE
    );

    return signedAuthEntry.toXDR('base64');
  }

  parseAuthEntry(authEntryXdr: string): {
    sessionId: number;
    player1: string;
    functionName: string;
  } {
    try {
      const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
      const credentials = authEntry.credentials();
      const addressCreds = credentials.address();
      const player1Address = addressCreds.address();
      const player1 = Address.fromScAddress(player1Address).toString();

      const rootInvocation = authEntry.rootInvocation();
      const authorizedFunction = rootInvocation.function();
      const contractFn = authorizedFunction.contractFn();
      const functionName = contractFn.functionName().toString();

      if (functionName !== 'create_session') {
        throw new Error(`Unexpected function: ${functionName}. Expected create_session.`);
      }

      const args = contractFn.args();
      if (args.length < 1) {
        throw new Error(`Expected at least 1 argument for create_session auth entry, got ${args.length}`);
      }

      const sessionId = args[0].u32();

      return {
        sessionId,
        player1,
        functionName,
      };
    } catch (err: any) {
      console.error('[parseAuthEntry] Error parsing auth entry:', err);
      throw new Error(`Failed to parse auth entry: ${err.message}`);
    }
  }

  async importAndSignAuthEntry(
    player1SignedAuthEntryXdr: string,
    player2Address: string,
    player2Signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    const gameParams = this.parseAuthEntry(player1SignedAuthEntryXdr);

    if (player2Address === gameParams.player1) {
      throw new Error('Cannot play against yourself. Player 2 must be different from Player 1.');
    }

    const buildClient = new RpsClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2Address,
    });

    const tx = await buildClient.create_session({
      session_id: gameParams.sessionId,
      player1: gameParams.player1,
      player2: player2Address,
    }, DEFAULT_METHOD_OPTIONS);

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

    const player2Client = this.createSigningClient(player2Address, player2Signer);
    const player2Tx = player2Client.txFromXDR(txWithInjectedAuth.toXDR());

    const needsSigning = await player2Tx.needsNonInvokerSigningBy();
    if (needsSigning.includes(player2Address)) {
      await player2Tx.signAuthEntries({ expiration: validUntilLedgerSeq });
    }

    return player2Tx.toXDR();
  }

  async finalizeCreateSession(
    xdr: string,
    signerAddress: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = client.txFromXDR(xdr);
    await tx.simulate();

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

  async commitMove(
    sessionId: number,
    player: string,
    commitment: Buffer,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.commit_move({
      session_id: sessionId,
      player,
      commitment,
    }, DEFAULT_METHOD_OPTIONS);

    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds);
    return sentTx.result;
  }

  async revealMove(
    sessionId: number,
    player: string,
    proof: Buffer,
    publicInputs: Buffer,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.reveal_move({
      session_id: sessionId,
      player,
      proof,
      public_inputs: publicInputs,
    }, { ...DEFAULT_METHOD_OPTIONS, simulate: false });

    await this.simulateWithBudgetLeeway(tx, 'Reveal move');

    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds);
    return sentTx.result;
  }

  async finalize(
    sessionId: number,
    player: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ) {
    const client = this.createSigningClient(player, signer);
    const tx = await client.finalize({ session_id: sessionId }, DEFAULT_METHOD_OPTIONS);
    const sentTx = await signAndSendViaLaunchtube(tx, DEFAULT_METHOD_OPTIONS.timeoutInSeconds);
    return sentTx.result;
  }
}
