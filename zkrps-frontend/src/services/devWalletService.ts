import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

/**
 * Dev Wallet Service
 * Provides test wallet functionality for local development
 * Uses secret keys from environment variables (populated by setup script)
 */
class DevWalletService {
  private currentPlayer: 1 | 2 | null = null;
  private keypairs: Record<string, Keypair> = {};

  /**
   * Check if dev mode is available
   */
  static isDevModeAvailable(): boolean {
    // Dev mode is available if we have the secret keys in environment
    return !!(
      import.meta.env.VITE_DEV_PLAYER1_SECRET &&
      import.meta.env.VITE_DEV_PLAYER2_SECRET
    );
  }

  /**
   * Check if a specific player is available
   */
  static isPlayerAvailable(playerNumber: 1 | 2): boolean {
    const secret = playerNumber === 1
      ? import.meta.env.VITE_DEV_PLAYER1_SECRET
      : import.meta.env.VITE_DEV_PLAYER2_SECRET;
    return !!secret && secret !== 'NOT_AVAILABLE';
  }

  /**
   * Initialize a player from environment variables
   */
  async initPlayer(playerNumber: 1 | 2): Promise<void> {
    try {
      const playerKey = `player${playerNumber}`;
      const secretEnvVar = playerNumber === 1
        ? import.meta.env.VITE_DEV_PLAYER1_SECRET
        : import.meta.env.VITE_DEV_PLAYER2_SECRET;

      if (!secretEnvVar || secretEnvVar === 'NOT_AVAILABLE') {
        throw new Error(`Player ${playerNumber} secret key not available. Run "bun run setup" first.`);
      }

      // Create keypair from secret key
      const keypair = Keypair.fromSecret(secretEnvVar);
      this.keypairs[playerKey] = keypair;
      this.currentPlayer = playerNumber;

      console.log(`Dev wallet initialized for Player ${playerNumber}: ${keypair.publicKey()}`);
    } catch (error) {
      console.error('Failed to initialize dev wallet:', error);
      throw error;
    }
  }

  /**
   * Get current player's public key
   */
  getPublicKey(): string {
    if (!this.currentPlayer) {
      throw new Error('No player initialized');
    }

    const playerKey = `player${this.currentPlayer}`;
    const keypair = this.keypairs[playerKey];

    if (!keypair) {
      throw new Error(`Player ${this.currentPlayer} not initialized`);
    }

    return keypair.publicKey();
  }

  /**
   * Get current player number
   */
  getCurrentPlayer(): 1 | 2 | null {
    return this.currentPlayer;
  }

  /**
   * Switch to another player
   */
  async switchPlayer(playerNumber: 1 | 2): Promise<void> {
    await this.initPlayer(playerNumber);
  }

  /**
   * Disconnect wallet
   */
  disconnect(): void {
    this.currentPlayer = null;
    this.keypairs = {};
  }

  /**
   * Get a signer for contract interactions
   * Uses actual keypair to sign transactions
   */
  getSigner(): ContractSigner {
    const playerKey = this.currentPlayer ? `player${this.currentPlayer}` : null;

    if (!playerKey || !this.keypairs[playerKey]) {
      throw new Error('No player initialized');
    }

    const keypair = this.keypairs[playerKey];
    const publicKey = keypair.publicKey();
    const toWalletError = (message: string): WalletError => ({ message, code: -1 });

    return {
      signTransaction: async (txXdr: string, opts?: any) => {
        try {
          if (!opts?.networkPassphrase) {
            throw new Error('Missing networkPassphrase');
          }

          const transaction = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
          transaction.sign(keypair);
          const signedTxXdr = transaction.toXDR();

          return {
            signedTxXdr,
            signerAddress: publicKey,
          };
        } catch (error) {
          console.error('Failed to sign transaction:', error);
          return {
            signedTxXdr: txXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign transaction'
            ),
          };
        }
      },

      signAuthEntry: async (preimageXdr: string, opts?: any) => {
        try {
          // `authorizeEntry` signs the *hash* of the preimage XDR (see stellar-base's `authorizeEntry`).
          // Dev wallet must match that behavior.
          const preimageBytes = Buffer.from(preimageXdr, 'base64');
          const payload = hash(preimageBytes);
          const signatureBytes = keypair.sign(payload);

          return {
            signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
            signerAddress: publicKey,
          };
        } catch (error) {
          console.error('Failed to sign auth entry:', error);
          return {
            signedAuthEntry: preimageXdr,
            signerAddress: publicKey,
            error: toWalletError(
              error instanceof Error ? error.message : 'Failed to sign auth entry'
            ),
          };
        }
      },
    };
  }
}

// Export singleton instance
export const devWalletService = new DevWalletService();
export { DevWalletService };
