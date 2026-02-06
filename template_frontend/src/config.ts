/**
 * Configuration loaded from environment variables
 * These are set by the setup script after deployment
 */

import { getAllContractIds, getContractId } from './utils/constants';

export const config = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  contractIds: getAllContractIds(),

  // Backwards-compatible aliases for built-in games
  mockGameHubId: getContractId('mock-game-hub'),
  twentyOneId: getContractId('twenty-one'),
  numberGuessId: getContractId('number-guess'),
  diceDuelId: getContractId('dice-duel'),

  devPlayer1Address: import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '',
  devPlayer2Address: import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '',
};

if (Object.keys(config.contractIds).length === 0) {
  console.warn('Contract IDs not configured. Run `bun run setup` from the repo root.');
}
