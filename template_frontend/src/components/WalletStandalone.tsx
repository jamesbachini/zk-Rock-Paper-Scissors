import { useWalletStandalone } from '../hooks/useWalletStandalone';
import './WalletStandalone.css';

export function WalletStandalone() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    error,
    isWalletAvailable,
    network,
    connect,
    disconnect,
  } = useWalletStandalone();

  const address = typeof publicKey === 'string' ? publicKey : '';
  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  return (
    <div className="wallet-standalone">
      {!isConnected ? (
        <button
          className="wallet-standalone-button"
          onClick={() => connect().catch(() => undefined)}
          disabled={!isWalletAvailable || isConnecting}
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      ) : (
        <button className="wallet-standalone-button" onClick={disconnect}>
          {shortAddress}
        </button>
      )}

      {network && <div className="wallet-standalone-network">{network}</div>}

      {!isWalletAvailable && (
        <div className="wallet-standalone-error">Wallet connection is only available in the browser.</div>
      )}
      {error && <div className="wallet-standalone-error">{error}</div>}
    </div>
  );
}
