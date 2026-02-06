// Runtime configuration for the ZK RPS frontend (testnet).
// This file is loaded by index.html before the app bundle.
// Do not put secrets in here.

window.__STELLAR_GAME_STUDIO_CONFIG__ = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractIds: {
    'mock-game-hub': 'CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG',
    'rps-game': 'CCDN7TQIPBCXGBJYPICCQKUQVMBDGKSY53Q4HEJ33HCEGGCTFD7FKJFC',
  },
};
