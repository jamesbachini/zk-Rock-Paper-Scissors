import { useState } from 'react';
import { TwentyOneGame } from '../games/twenty-one/TwentyOneGame';
import { NumberGuessGame } from '../games/number-guess/NumberGuessGame';
import { DiceDuelGame } from '../games/dice-duel/DiceDuelGame';
import { useWallet } from '@/hooks/useWallet';
import typezeroHero from '../assets/typezero-hero.png';
import './GamesCatalog.css';

const games = [
  {
    id: 'twenty-one',
    title: 'Twenty-One',
    emoji: '🃏',
    description: 'Card strategy duel where close-to-21 wins without busting.',
    tags: ['2 players', 'Card strategy'],
  },
  {
    id: 'number-guess',
    title: 'Number Guess',
    emoji: '🎯',
    description: 'Pick a number, lock it in, and reveal the closest guess.',
    tags: ['2 players', 'Fast rounds'],
  },
  {
    id: 'dice-duel',
    title: 'Dice Duel',
    emoji: '🎲',
    description: 'Roll two dice each and race for the highest total.',
    tags: ['2 players', 'Quick launch'],
  },
];

interface GamesCatalogProps {
  onBack?: () => void;
}

export function GamesCatalog({ onBack }: GamesCatalogProps) {
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const { publicKey, isConnected, isConnecting, error } = useWallet();

  const userAddress = publicKey ?? '';

  const handleSelectGame = (gameId: string) => {
    setSelectedGame(gameId);
  };

  const handleBackToLibrary = () => {
    setSelectedGame(null);
  };

  if (selectedGame === 'twenty-one') {
    return (
      <TwentyOneGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'number-guess') {
    return (
      <NumberGuessGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  if (selectedGame === 'dice-duel') {
    return (
      <DiceDuelGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onBack={handleBackToLibrary}
        onStandingsRefresh={() => console.log('Refresh standings')}
        onGameComplete={() => console.log('Game complete')}
      />
    );
  }

  return (
    <div className="library-page">
      <div className="library-header">
        {onBack ? (
          <button className="btn-secondary" onClick={onBack}>
            Back to Studio
          </button>
        ) : null}
        <div className="library-intro">
          <h2>Games Library</h2>
          <p>Choose a template to play now or fork into your own title.</p>
        </div>
      </div>

      {!isConnected && (
        <div className="card wallet-banner">
          {error ? (
            <>
              <h3>Wallet Connection Error</h3>
              <p>{error}</p>
            </>
          ) : (
            <>
              <h3>{isConnecting ? 'Connecting...' : 'Connect a Dev Wallet'}</h3>
              <p>Use the switcher above to auto-connect and swap between demo players.</p>
            </>
          )}
        </div>
      )}

      <div className="games-grid">
        {games.map((game, index) => (
          <button
            key={game.id}
            className="game-card"
            type="button"
            disabled={!isConnected}
            onClick={() => handleSelectGame(game.id)}
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <div className="game-card-header">
              <span className="game-emoji">{game.emoji}</span>
              <span className="game-title">{game.title}</span>
            </div>
            <p className="game-description">{game.description}</p>
            <div className="game-tags">
              {game.tags.map((tag) => (
                <span key={tag} className="game-tag">
                  {tag}
                </span>
              ))}
            </div>
            <div className="game-cta">Launch Game</div>
          </button>
        ))}
      </div>

      <section className="zk-section">
        <div className="zk-header">
          <h3>Zero Knowledge Games</h3>
        </div>
        <div className="zk-grid">
          <a
            className="zk-card"
            href="https://github.com/jamesbachini/typezero/"
            target="_blank"
            rel="noreferrer"
          >
            <div className="zk-card-text">
              <div className="zk-card-title">TypeZero</div>
              <p className="zk-card-description">
                A typing game built with RISC Zero and Stellar.
              </p>
              <div className="zk-card-cta">Open on GitHub</div>
            </div>
            <div className="zk-media">
              <img
                src={typezeroHero}
                alt="TypeZero gameplay screenshot"
                loading="lazy"
              />
            </div>
          </a>
        </div>
      </section>
    </div>
  );
}
