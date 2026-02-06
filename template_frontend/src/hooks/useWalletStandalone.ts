import { useCallback, useEffect } from 'react';
import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { KitEventType, Networks } from '@creit-tech/stellar-wallets-kit/types';
import { useWalletStore } from '../store/walletSlice';
import { NETWORK, NETWORK_PASSPHRASE } from '../utils/constants';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

const WALLET_ID = 'stellar-wallets-kit';
let kitInitialized = false;

function toWalletError(error?: { message: string; code: number }): WalletError | undefined {
  if (!error) return undefined;
  return { message: error.message, code: error.code };
}

function resolveNetwork(passphrase?: string): Networks {
  if (passphrase && Object.values(Networks).includes(passphrase as Networks)) {
    return passphrase as Networks;
  }

  return NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

function ensureKitInitialized(passphrase?: string) {
  if (typeof window === 'undefined') return;

  if (!kitInitialized) {
    StellarWalletsKit.init({
      modules: defaultModules(),
      network: resolveNetwork(passphrase),
    });
    kitInitialized = true;
    return;
  }

  if (passphrase) {
    StellarWalletsKit.setNetwork(resolveNetwork(passphrase));
  }
}

export function useWalletStandalone() {
  const {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    setWallet,
    setConnecting,
    setNetwork,
    setError,
    disconnect: storeDisconnect,
  } = useWalletStore();

  const isWalletAvailable = typeof window !== 'undefined';

  const connect = useCallback(async () => {
    if (typeof window === 'undefined') {
      setError('Wallet connection is only available in the browser.');
      return;
    }

    try {
      setConnecting(true);
      setError(null);

      ensureKitInitialized(NETWORK_PASSPHRASE);
      const { address } = await StellarWalletsKit.authModal();
      if (typeof address !== 'string' || !address) {
        throw new Error('No wallet address returned');
      }

      setWallet(address, WALLET_ID, 'wallet');
      setNetwork(NETWORK, NETWORK_PASSPHRASE);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [setWallet, setConnecting, setError, setNetwork]);

  const refresh = useCallback(async () => {
    try {
      if (typeof window === 'undefined') return;
      ensureKitInitialized(NETWORK_PASSPHRASE);
      const address = await StellarWalletsKit.getAddress();
      if (typeof address === 'string' && address) {
        setWallet(address, WALLET_ID, 'wallet');
        setNetwork(NETWORK, NETWORK_PASSPHRASE);
      }
    } catch {
      // ignore refresh failures
    }
  }, [setWallet, setNetwork]);

  const disconnect = useCallback(() => {
    storeDisconnect();
  }, [storeDisconnect]);

  const connectDev = useCallback(async (_playerNumber?: 1 | 2) => {
    setError('Dev wallets are not available in standalone mode.');
    throw new Error('Dev wallets are not available in standalone mode.');
  }, [setError]);

  const switchPlayer = useCallback(async (_playerNumber?: 1 | 2) => {
    setError('Dev wallets are not available in standalone mode.');
    throw new Error('Dev wallets are not available in standalone mode.');
  }, [setError]);

  const isDevModeAvailable = useCallback(() => false, []);

  const isDevPlayerAvailable = useCallback(() => false, []);

  const getCurrentDevPlayer = useCallback(() => null, []);

  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey) {
      throw new Error('Wallet not connected');
    }

    return {
      signTransaction: async (
        xdr: string,
        opts?: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string }
      ) => {
        try {
          ensureKitInitialized(networkPassphrase || NETWORK_PASSPHRASE);
          const result = await StellarWalletsKit.signTransaction(xdr, {
            networkPassphrase: opts?.networkPassphrase || networkPassphrase || NETWORK_PASSPHRASE,
            address: opts?.address || publicKey,
            submit: opts?.submit,
            submitUrl: opts?.submitUrl,
          });

          return {
            signedTxXdr: result.signedTxXdr || xdr,
            signerAddress: result.signerAddress || publicKey,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign transaction';
          return {
            signedTxXdr: xdr,
            signerAddress: publicKey,
            error: toWalletError({ message, code: -1 }),
          };
        }
      },

      signAuthEntry: async (authEntry: string, opts?: { networkPassphrase?: string; address?: string }) => {
        try {
          ensureKitInitialized(networkPassphrase || NETWORK_PASSPHRASE);
          const result = await StellarWalletsKit.signAuthEntry(authEntry, {
            networkPassphrase: opts?.networkPassphrase || networkPassphrase || NETWORK_PASSPHRASE,
            address: opts?.address || publicKey,
          });

          return {
            signedAuthEntry: result.signedAuthEntry || authEntry,
            signerAddress: result.signerAddress || publicKey,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sign auth entry';
          return {
            signedAuthEntry: authEntry,
            signerAddress: publicKey,
            error: toWalletError({ message, code: -1 }),
          };
        }
      },
    };
  }, [isConnected, publicKey, networkPassphrase]);

  useEffect(() => {
    const bootstrap = async () => {
      if (typeof window === 'undefined') return;
      ensureKitInitialized(NETWORK_PASSPHRASE);
      try {
        const address = await StellarWalletsKit.getAddress();
        if (typeof address === 'string' && address) {
          setWallet(address, WALLET_ID, 'wallet');
          setNetwork(NETWORK, NETWORK_PASSPHRASE);
        }
      } catch {
        // ignore if no active address
      }
    };

    bootstrap().catch(() => undefined);

    if (typeof window === 'undefined') {
      return;
    }

    ensureKitInitialized(NETWORK_PASSPHRASE);
    const unsubscribeState = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
      const address = event.payload.address;
      if (typeof address === 'string' && address) {
        setWallet(address, WALLET_ID, 'wallet');
      } else {
        storeDisconnect();
      }
      setNetwork(NETWORK, event.payload.networkPassphrase || NETWORK_PASSPHRASE);
    });

    const unsubscribeDisconnect = StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
      storeDisconnect();
    });

    return () => {
      unsubscribeState();
      unsubscribeDisconnect();
    };
  }, [setWallet, setNetwork, storeDisconnect]);

  return {
    // State
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    isWalletAvailable,

    // Actions
    connect,
    refresh,
    disconnect,
    getContractSigner,
    connectDev,
    switchPlayer,
    isDevModeAvailable,
    isDevPlayerAvailable,
    getCurrentDevPlayer,
  };
}
