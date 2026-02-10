/**
 * Application constants
 * Configuration loaded from environment variables
 */

export type StellarNetwork = 'testnet' | 'futurenet' | 'mainnet' | 'custom';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const FUTURENET_PASSPHRASE = 'Test SDF Future Network ; October 2022';
export const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE || FUTURENET_PASSPHRASE;

function resolveNetwork(passphrase: string): StellarNetwork {
  if (passphrase === TESTNET_PASSPHRASE) return 'testnet';
  if (passphrase === FUTURENET_PASSPHRASE) return 'futurenet';
  if (passphrase === MAINNET_PASSPHRASE) return 'mainnet';
  return 'custom';
}

export const NETWORK = resolveNetwork(NETWORK_PASSPHRASE);

const DEFAULT_RPC_URL_BY_NETWORK: Record<Exclude<StellarNetwork, 'custom'>, string> = {
  testnet: 'https://soroban-testnet.stellar.org',
  futurenet: 'https://rpc-futurenet.stellar.org',
  mainnet: 'https://mainnet.sorobanrpc.com',
};

const defaultRpcUrl = NETWORK === 'custom'
  ? DEFAULT_RPC_URL_BY_NETWORK.futurenet
  : DEFAULT_RPC_URL_BY_NETWORK[NETWORK];

export const SOROBAN_RPC_URL =
  import.meta.env.VITE_SOROBAN_RPC_URL || defaultRpcUrl;
export const RPC_URL = SOROBAN_RPC_URL; // Alias for compatibility

const DEFAULT_HORIZON_URL_BY_NETWORK: Partial<Record<StellarNetwork, string>> = {
  testnet: 'https://horizon-testnet.stellar.org',
  futurenet: 'https://horizon-futurenet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
};

const DEFAULT_FRIENDBOT_URL_BY_NETWORK: Partial<Record<StellarNetwork, string>> = {
  testnet: 'https://friendbot.stellar.org',
  futurenet: 'https://friendbot-futurenet.stellar.org',
};

export const HORIZON_URL =
  import.meta.env.VITE_HORIZON_URL || DEFAULT_HORIZON_URL_BY_NETWORK[NETWORK] || '';
export const FRIEND_BOT_URL =
  import.meta.env.VITE_FRIENDBOT_URL || DEFAULT_FRIENDBOT_URL_BY_NETWORK[NETWORK] || '';
export const FRIEND_BOT_AVAILABLE = FRIEND_BOT_URL.length > 0;

function contractEnvKey(crateName: string): string {
  // Crate name -> env key matches scripts/utils/contracts.ts: hyphens become underscores.
  const envKey = crateName.replace(/-/g, '_').toUpperCase();
  return `VITE_${envKey}_CONTRACT_ID`;
}

export function getContractId(crateName: string): string {
  const env = import.meta.env as unknown as Record<string, string>;
  return env[contractEnvKey(crateName)] || '';
}

export function getAllContractIds(): Record<string, string> {
  const env = import.meta.env as unknown as Record<string, string>;
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('VITE_') || !key.endsWith('_CONTRACT_ID')) continue;
    if (!value) continue;

    const envKey = key.slice('VITE_'.length, key.length - '_CONTRACT_ID'.length);
    const crateName = envKey.toLowerCase().replace(/_/g, '-');
    if (!out[crateName]) {
      out[crateName] = value;
    }
  }

  return out;
}

// Contract IDs (backwards-compatible named exports for built-in games)
export const MOCK_GAME_HUB_CONTRACT = getContractId('mock-game-hub');
export const TWENTY_ONE_CONTRACT = getContractId('twenty-one');
export const RPS_GAME_CONTRACT = getContractId('rps-game');
export const DICE_DUEL_CONTRACT = getContractId('dice-duel');

// Dev wallet addresses
export const DEV_ADMIN_ADDRESS = import.meta.env.VITE_DEV_ADMIN_ADDRESS || '';
export const DEV_PLAYER1_ADDRESS = import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '';
export const DEV_PLAYER2_ADDRESS = import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '';

// Runtime-configurable simulation source (for standalone builds)
export const RUNTIME_SIMULATION_SOURCE = import.meta.env.VITE_SIMULATION_SOURCE_ADDRESS || '';

// Transaction options
export const DEFAULT_METHOD_OPTIONS = {
  timeoutInSeconds: 30,
};

// Auth TTL constants (in minutes)
export const DEFAULT_AUTH_TTL_MINUTES = 5;
export const MULTI_SIG_AUTH_TTL_MINUTES = 60;
