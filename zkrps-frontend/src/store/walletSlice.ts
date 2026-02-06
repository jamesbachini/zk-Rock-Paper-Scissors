import { create } from 'zustand';

export interface WalletState {
  // Wallet connection
  publicKey: string | null;
  walletId: string | null; // ID of the connected wallet
  walletType: 'dev' | 'wallet' | null; // Track if dev wallet or real wallet
  isConnected: boolean;
  isConnecting: boolean;

  // Network info
  network: string | null;
  networkPassphrase: string | null;

  // Error handling
  error: string | null;

  // Actions
  setWallet: (publicKey: string, walletId: string, walletType: 'dev' | 'wallet') => void;
  setPublicKey: (publicKey: string) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setNetwork: (network: string, networkPassphrase: string) => void;
  setError: (error: string | null) => void;
  disconnect: () => void;
  reset: () => void;
}

const initialState = {
  publicKey: null,
  walletId: null,
  walletType: null,
  isConnected: false,
  isConnecting: false,
  network: null,
  networkPassphrase: null,
  error: null,
};

export const useWalletStore = create<WalletState>()((set) => ({
  ...initialState,

  setWallet: (publicKey, walletId, walletType) =>
    set({
      publicKey,
      walletId,
      walletType,
      isConnected: true,
      isConnecting: false,
      error: null,
    }),

  setPublicKey: (publicKey) =>
    set({
      publicKey,
      isConnected: true,
      isConnecting: false,
      error: null,
    }),

  setConnected: (connected) =>
    set({
      isConnected: connected,
      isConnecting: false,
    }),

  setConnecting: (connecting) =>
    set({
      isConnecting: connecting,
      error: null,
    }),

  setNetwork: (network, networkPassphrase) =>
    set({
      network,
      networkPassphrase,
    }),

  setError: (error) =>
    set({
      error,
      isConnecting: false,
    }),

  disconnect: () =>
    set({
      ...initialState,
    }),

  reset: () => set(initialState),
}));
