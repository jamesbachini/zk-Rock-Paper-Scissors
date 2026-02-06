import { useState, useEffect, useRef } from 'react';
import { twentyOneService } from './twentyOneService';
import { requestCache, createCacheKey } from '@/utils/requestCache';
import { useWallet } from '@/hooks/useWallet';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    }
    return value;
  }

  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

interface TwentyOneGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onBack: () => void;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

interface GameState {
  player1: string;
  player2: string;
  player1_points: bigint;
  player2_points: bigint;
  player1_hand: Uint8Array;
  player2_hand: Uint8Array;
  player1_stuck: boolean;
  player2_stuck: boolean;
  winner: string | null;
  round: number;
}

// Card component with suit and value
const PlayingCard = ({ value, isHidden = false }: { value: number; isHidden?: boolean }) => {
  const getCardDisplay = (val: number) => {
    if (val === 1) return { display: 'A', name: 'Ace' };
    if (val <= 10) return { display: val.toString(), name: val.toString() };
    if (val === 11) return { display: 'J', name: 'Jack' };
    if (val === 12) return { display: 'Q', name: 'Queen' };
    if (val === 13) return { display: 'K', name: 'King' };
    return { display: '?', name: 'Unknown' };
  };

  const getSuit = (val: number) => {
    // Distribute cards across suits for visual variety
    const suitIndex = (val - 1) % 4;
    const suits = [
      { symbol: '♠', color: 'text-[#111827]', name: 'Spades' },
      { symbol: '♥', color: 'text-[#dc2626]', name: 'Hearts' },
      { symbol: '♣', color: 'text-[#111827]', name: 'Clubs' },
      { symbol: '♦', color: 'text-[#dc2626]', name: 'Diamonds' },
    ];
    return suits[suitIndex];
  };

  if (isHidden) {
    return (
      <div className="relative w-20 h-28 rounded-md bg-gradient-to-br from-blue-600 to-blue-800 shadow-xl border-4 border-blue-900 flex items-center justify-center transform transition-all hover:scale-105">
        <div className="text-4xl">🎴</div>
      </div>
    );
  }

  const card = getCardDisplay(value);
  const suit = getSuit(value);

  return (
    <div className="relative w-20 h-28 rounded-md bg-[#ffffff] shadow-xl border-2 border-gray-300 transform transition-all hover:scale-105 animate-dealCard overflow-hidden">
      {/* Center suit (single symbol) */}
      <div className={`absolute inset-0 flex items-center justify-center text-5xl leading-none ${suit.color} pointer-events-none select-none`}>
        {suit.symbol}
      </div>

      {/* Corners (value only) */}
      <div className={`absolute top-1 left-1 text-lg font-black leading-none ${suit.color} select-none`}>
        {card.display}
      </div>
      <div className={`absolute bottom-1 right-1 text-lg font-black leading-none ${suit.color} rotate-180 select-none`}>
        {card.display}
      </div>
    </div>
  );
};

export function TwentyOneGame({
  userAddress,
  availablePoints,
  initialXDR,
  initialSessionId,
  onBack,
  onStandingsRefresh,
  onGameComplete
}: TwentyOneGameProps) {
  const DEFAULT_POINTS = '0.1';
  const { getContractSigner, walletType } = useWallet();
  const normalizedUserAddress = userAddress.trim().toUpperCase();
  const normalizeAddress = (address: string) => address.trim().toUpperCase();
  const [sessionId, setSessionId] = useState<number>(() => createRandomSessionId());
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [gamePhase, setGamePhase] = useState<'create' | 'play' | 'reveal' | 'complete'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [xdrParsing, setXdrParsing] = useState(false);
  const [xdrParseError, setXdrParseError] = useState<string | null>(null);
  const [xdrParseSuccess, setXdrParseSuccess] = useState(false);
  const [player1HandValue, setPlayer1HandValue] = useState<number | null>(null);
  const [player2HandValue, setPlayer2HandValue] = useState<number | null>(null);

  useEffect(() => {
    setPlayer1Address(userAddress);
  }, [userAddress]);

  useEffect(() => {
    if (createMode === 'import' && !importPlayer2Points.trim()) {
      setImportPlayer2Points(DEFAULT_POINTS);
    }
  }, [createMode, importPlayer2Points]);

  const POINTS_DECIMALS = 7;
  const isBusy = loading || quickstartLoading;
  const actionLock = useRef(false);
  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) {
      return;
    }
    actionLock.current = true;
    try {
      await action();
    } finally {
      actionLock.current = false;
    }
  };

  const parsePoints = (value: string): bigint | null => {
    try {
      const cleaned = value.replace(/[^\d.]/g, '');
      if (!cleaned || cleaned === '.') return null;

      const [whole = '0', fraction = ''] = cleaned.split('.');
      const paddedFraction = fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS);
      return BigInt(whole + paddedFraction);
    } catch {
      return null;
    }
  };

  const loadGameState = async () => {
    try {
      // Always fetch latest game state to avoid stale cached results after transactions.
      const game = await twentyOneService.getGame(sessionId);

      if (game) {
        setGameState(game);

        // Load hand values
        try {
          const p1Value = await twentyOneService.getHandValue(sessionId, game.player1);
          const p2Value = await twentyOneService.getHandValue(sessionId, game.player2);
          setPlayer1HandValue(p1Value);
          setPlayer2HandValue(p2Value);
        } catch (err) {
          console.log('Error loading hand values:', err);
        }

        // Determine game phase
        if (game.winner) {
          setGamePhase('complete');
        } else if (game.player1_stuck && game.player2_stuck) {
          setGamePhase('reveal');
        } else {
          setGamePhase('play');
        }
      }
    } catch (err) {
      setGameState(null);
    }
  };

  useEffect(() => {
    if (gamePhase !== 'create') {
      loadGameState();
      const interval = setInterval(loadGameState, 5000);
      return () => clearInterval(interval);
    }
  }, [sessionId, gamePhase]);

  useEffect(() => {
    if (gamePhase === 'complete' && gameState?.winner) {
      console.log('Game completed! Refreshing standings...');
      onStandingsRefresh();
    }
  }, [gamePhase, gameState?.winner]);

  // Handle initial values (similar to NumberGuess)
  useEffect(() => {
    if (initialXDR) {
      try {
        const parsed = twentyOneService.parseAuthEntry(initialXDR);
        const sessionId = parsed.sessionId;

        twentyOneService.getGame(sessionId)
          .then((game) => {
            if (game) {
              setGameState(game);
              setGamePhase('play');
              setSessionId(sessionId);
            } else {
              setCreateMode('import');
              setImportAuthEntryXDR(initialXDR);
              setImportSessionId(sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          })
          .catch(() => {
            setCreateMode('import');
            setImportAuthEntryXDR(initialXDR);
            setImportPlayer2Points('0.1');
          });
      } catch (err) {
        setCreateMode('import');
        setImportAuthEntryXDR(initialXDR);
        setImportPlayer2Points('0.1');
      }
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const authEntry = urlParams.get('auth');
    const urlSessionId = urlParams.get('session-id');

    if (authEntry) {
      try {
        const parsed = twentyOneService.parseAuthEntry(authEntry);
        twentyOneService.getGame(parsed.sessionId)
          .then((game) => {
            if (game) {
              setGameState(game);
              setGamePhase('play');
              setSessionId(parsed.sessionId);
            } else {
              setCreateMode('import');
              setImportAuthEntryXDR(authEntry);
              setImportSessionId(parsed.sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          });
      } catch (err) {
        setCreateMode('import');
        setImportAuthEntryXDR(authEntry);
        setImportPlayer2Points('0.1');
      }
    } else if (urlSessionId) {
      setCreateMode('load');
      setLoadSessionId(urlSessionId);
    } else if (initialSessionId) {
      setCreateMode('load');
      setLoadSessionId(initialSessionId.toString());
    }
  }, [initialXDR, initialSessionId]);

  // Auto-parse Auth Entry XDR
  useEffect(() => {
    if (createMode !== 'import' || !importAuthEntryXDR.trim()) {
      if (!importAuthEntryXDR.trim()) {
        setXdrParsing(false);
        setXdrParseError(null);
        setXdrParseSuccess(false);
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      }
      return;
    }

    const parseXDR = async () => {
      setXdrParsing(true);
      setXdrParseError(null);
      setXdrParseSuccess(false);

      try {
        const gameParams = twentyOneService.parseAuthEntry(importAuthEntryXDR.trim());

        if (normalizeAddress(gameParams.player1) === normalizedUserAddress) {
          throw new Error('You cannot play against yourself. This auth entry was created by you (Player 1).');
        }

        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());
        setXdrParseSuccess(true);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid auth entry XDR';
        setXdrParseError(errorMsg);
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      } finally {
        setXdrParsing(false);
      }
    };

    const timeoutId = setTimeout(parseXDR, 500);
    return () => clearTimeout(timeoutId);
  }, [importAuthEntryXDR, createMode, userAddress]);

  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const signer = getContractSigner();
        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([player1Address, userAddress]);
        const placeholderP2Points = p1Points;

        const authEntryXDR = await twentyOneService.prepareStartGame(
          sessionId,
          player1Address,
          placeholderPlayer2Address,
          p1Points,
          placeholderP2Points,
          signer
        );

        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Auth entry signed! Copy and send to Player 2. Waiting for them to sign...');

        const pollInterval = setInterval(async () => {
          try {
            const game = await twentyOneService.getGame(sessionId);
            if (game) {
              clearInterval(pollInterval);
              setGameState(game);
              setExportedAuthEntryXDR(null);
              setSuccess('Game created! Player 2 has signed and submitted.');
              setGamePhase('play');
              onStandingsRefresh();
              setTimeout(() => setSuccess(null), 2000);
            }
          } catch (err) {
            // Continue polling
          }
        }, 3000);

        setTimeout(() => clearInterval(pollInterval), 300000);
      } catch (err) {
        console.error('Prepare transaction error:', err);
        setError(err instanceof Error ? err.message : 'Failed to prepare transaction');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true);
        setError(null);
        setSuccess(null);
        if (walletType !== 'dev') {
          throw new Error('Quickstart only works with dev wallets in the Games Library.');
        }

        if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Quickstart requires both dev wallets. Run "bun run setup" and connect a dev wallet.');
        }

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const originalPlayer = devWalletService.getCurrentPlayer();
        let player1AddressQuickstart = '';
        let player2AddressQuickstart = '';
        let player1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        let player2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;

        try {
          await devWalletService.initPlayer(1);
          player1AddressQuickstart = devWalletService.getPublicKey();
          player1Signer = devWalletService.getSigner();

          await devWalletService.initPlayer(2);
          player2AddressQuickstart = devWalletService.getPublicKey();
          player2Signer = devWalletService.getSigner();
        } finally {
          if (originalPlayer) {
            await devWalletService.initPlayer(originalPlayer);
          }
        }

        if (!player1Signer || !player2Signer) {
          throw new Error('Quickstart failed to initialize dev wallet signers.');
        }

        if (player1AddressQuickstart === player2AddressQuickstart) {
          throw new Error('Quickstart requires two different dev wallets.');
        }

        const quickstartSessionId = createRandomSessionId();
        setSessionId(quickstartSessionId);
        setPlayer1Address(player1AddressQuickstart);
        setCreateMode('create');
        setExportedAuthEntryXDR(null);
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);
        setLoadSessionId('');

        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([
          player1AddressQuickstart,
          player2AddressQuickstart,
        ]);

        const authEntryXDR = await twentyOneService.prepareStartGame(
          quickstartSessionId,
          player1AddressQuickstart,
          placeholderPlayer2Address,
          p1Points,
          p1Points,
          player1Signer
        );

        const fullySignedTxXDR = await twentyOneService.importAndSignAuthEntry(
          authEntryXDR,
          player2AddressQuickstart,
          p1Points,
          player2Signer
        );

        await twentyOneService.finalizeStartGame(
          fullySignedTxXDR,
          player2AddressQuickstart,
          player2Signer
        );

        try {
          const game = await twentyOneService.getGame(quickstartSessionId);
          setGameState(game);
        } catch (err) {
          console.log('Quickstart game not available yet:', err);
        }
        setGamePhase('play');
        onStandingsRefresh();
        setSuccess('Quickstart complete! Both players signed and the game is ready.');
        setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      console.error('Quickstart error:', err);
      setError(err instanceof Error ? err.message : 'Quickstart failed');
    } finally {
      setQuickstartLoading(false);
    }
    });
  };

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        if (!importAuthEntryXDR.trim()) {
          throw new Error('Enter auth entry XDR from Player 1');
        }
        if (!importPlayer2Points.trim()) {
          throw new Error('Enter your points amount (Player 2)');
        }

        const p2Points = parsePoints(importPlayer2Points);
        if (!p2Points || p2Points <= 0n) {
          throw new Error('Invalid Player 2 points');
        }

        const gameParams = twentyOneService.parseAuthEntry(importAuthEntryXDR.trim());

        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());

        if (normalizeAddress(gameParams.player1) === normalizedUserAddress) {
          throw new Error('Invalid game: You cannot play against yourself');
        }

        const signer = getContractSigner();

        const fullySignedTxXDR = await twentyOneService.importAndSignAuthEntry(
          importAuthEntryXDR.trim(),
          userAddress,
          p2Points,
          signer
        );

        await twentyOneService.finalizeStartGame(
          fullySignedTxXDR,
          userAddress,
          signer
        );

        setSessionId(gameParams.sessionId);
        setSuccess('Game created successfully! Both players signed.');
        setGamePhase('play');

        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);

        await loadGameState();
        onStandingsRefresh();
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Import transaction error:', err);
        setError(err instanceof Error ? err.message : 'Failed to import and sign transaction');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleLoadExistingGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const parsedSessionId = parseInt(loadSessionId.trim());
        if (isNaN(parsedSessionId) || parsedSessionId <= 0) {
          throw new Error('Enter a valid session ID');
        }

        const game = await requestCache.dedupe(
          createCacheKey('twenty-one-game-state', parsedSessionId),
          () => twentyOneService.getGame(parsedSessionId),
          5000
        );

        if (!game) {
          throw new Error('Game not found');
        }

        if (normalizeAddress(game.player1) !== normalizedUserAddress && normalizeAddress(game.player2) !== normalizedUserAddress) {
          throw new Error('You are not a player in this game');
        }

        setSessionId(parsedSessionId);
        setGameState(game);
        setLoadSessionId('');

        if (game.winner) {
          setGamePhase('complete');
          const isWinner = normalizeAddress(game.winner) === normalizedUserAddress;
          setSuccess(isWinner ? '🎉 You won this game!' : 'Game complete. Winner revealed.');
        } else if (game.player1_stuck && game.player2_stuck) {
          setGamePhase('reveal');
          setSuccess('Game loaded! Both players have stuck. You can reveal the winner.');
        } else {
          setGamePhase('play');
          setSuccess('Game loaded! Continue playing.');
        }

        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Load game error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    });
  };

  const copyAuthEntryToClipboard = async () => {
    if (exportedAuthEntryXDR) {
      try {
        await navigator.clipboard.writeText(exportedAuthEntryXDR);
        setAuthEntryCopied(true);
        setTimeout(() => setAuthEntryCopied(false), 2000);
      } catch (err) {
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyShareGameUrlWithAuthEntry = async () => {
    if (exportedAuthEntryXDR) {
      try {
        const params = new URLSearchParams({
          'game': 'twenty-one',
          'auth': exportedAuthEntryXDR,
        });

        const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        await navigator.clipboard.writeText(shareUrl);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      } catch (err) {
        setError('Failed to copy to clipboard');
      }
    }
  };

  const handleHit = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const signer = getContractSigner();
        await twentyOneService.hit(sessionId, userAddress, signer);

        setSuccess('Card drawn!');
        await loadGameState();

        // Check if player busted
        if (gameState && gameState.winner) {
          setTimeout(() => {
            setSuccess(null);
            setGamePhase('complete');
          }, 1000);
        }
      } catch (err) {
        console.error('Hit error:', err);
        setError(err instanceof Error ? err.message : 'Failed to draw card');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleStick = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const signer = getContractSigner();
        await twentyOneService.stick(sessionId, userAddress, signer);

        setSuccess('You stuck!');
        await loadGameState();
      } catch (err) {
        console.error('Stick error:', err);
        setError(err instanceof Error ? err.message : 'Failed to stick');
      } finally {
        setLoading(false);
      }
    });
  };

  const waitForWinner = async () => {
    let updatedGame = await twentyOneService.getGame(sessionId);
    let attempts = 0;
    while (attempts < 5 && (!updatedGame || !updatedGame.winner)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      updatedGame = await twentyOneService.getGame(sessionId);
      attempts += 1;
    }
    return updatedGame;
  };

  const handleRevealWinner = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const signer = getContractSigner();
        const winnerResult = await twentyOneService.revealWinner(sessionId, userAddress, signer);

        await waitForWinner();
        await loadGameState();

        const winner = (winnerResult as any).unwrap ? (winnerResult as any).unwrap() : winnerResult;
        const isWinner = normalizeAddress(winner) === normalizedUserAddress;
        setSuccess(isWinner ? '🎉 You won!' : 'Game complete! Winner revealed.');

        onStandingsRefresh();
      } catch (err) {
        console.error('Reveal winner error:', err);
        setError(err instanceof Error ? err.message : 'Failed to reveal winner');
      } finally {
        setLoading(false);
      }
    });
  };

  const isPlayer1 = !!gameState && normalizeAddress(gameState.player1) === normalizedUserAddress;
  const isPlayer2 = !!gameState && normalizeAddress(gameState.player2) === normalizedUserAddress;
  const canAct = (isPlayer1 && !gameState?.player1_stuck) || (isPlayer2 && !gameState?.player2_stuck);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800 via-green-700 to-green-900 p-8">
      <style>{`
        @keyframes dealCard {
          from {
            transform: translateY(-100px) rotateZ(15deg);
            opacity: 0;
          }
          to {
            transform: translateY(0) rotateZ(0deg);
            opacity: 1;
          }
        }
        .animate-dealCard {
          animation: dealCard 0.5s ease-out;
        }
      `}</style>

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-5xl font-black text-white mb-2 drop-shadow-lg">
              🃏 Twenty-One
            </h1>
            <p className="text-xl text-green-200 font-semibold">
              Get as close to 21 as you can without going over!
            </p>
            <p className="text-sm text-green-300 font-mono mt-1">
              Session ID: {sessionId}
            </p>
          </div>
          <button
            onClick={() => {
              if (gameState?.winner) {
                onGameComplete();
              }
              onBack();
            }}
            className="px-6 py-3 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white font-bold transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            ← Back to Games
          </button>
        </div>

        {/* Error & Success Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/90 backdrop-blur-sm border-2 border-red-700 rounded-xl">
            <p className="text-white font-semibold">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-500/90 backdrop-blur-sm border-2 border-green-700 rounded-xl">
            <p className="text-white font-semibold">{success}</p>
          </div>
        )}

        {/* CREATE PHASE */}
        {gamePhase === 'create' && (
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl p-8 shadow-2xl">
            {/* Mode Toggle */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 p-2 bg-gray-100 rounded-xl mb-6">
              <button
                onClick={() => {
                  setCreateMode('create');
                  setExportedAuthEntryXDR(null);
                  setImportAuthEntryXDR('');
                  setLoadSessionId('');
                }}
                className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                  createMode === 'create'
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Create & Export
              </button>
              <button
                onClick={() => {
                  setCreateMode('import');
                  setExportedAuthEntryXDR(null);
                  setLoadSessionId('');
                }}
                className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                  createMode === 'import'
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Import Auth Entry
              </button>
              <button
                onClick={() => {
                  setCreateMode('load');
                  setExportedAuthEntryXDR(null);
                  setImportAuthEntryXDR('');
                }}
                className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                  createMode === 'load'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Load Existing Game
              </button>
            </div>

            <div className="p-4 mb-6 bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-yellow-900">⚡ Quickstart (Dev)</p>
                  <p className="text-xs font-semibold text-yellow-800">
                    Creates and signs for both dev wallets in one click. Works only in the Games Library.
                  </p>
                </div>
                <button
                  onClick={handleQuickStart}
                  disabled={isBusy || !quickstartAvailable}
                  className="px-4 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none"
                >
                  {quickstartLoading ? 'Quickstarting...' : '⚡ Quickstart Game'}
                </button>
              </div>
            </div>

            {createMode === 'create' ? (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      Your Address (Player 1)
                    </label>
                    <input
                      type="text"
                      value={player1Address}
                      onChange={(e) => setPlayer1Address(e.target.value.trim())}
                      placeholder="G..."
                      className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium text-gray-700"
                    />
                    <p className="text-xs font-semibold text-gray-600 mt-1">
                      Pre-filled from your connected wallet. If you change it, you must be able to sign as that address.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      Your Points
                    </label>
                    <input
                      type="text"
                      value={player1Points}
                      onChange={(e) => setPlayer1Points(e.target.value)}
                      placeholder="0.1"
                      className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium"
                    />
                    <p className="text-xs font-semibold text-gray-600 mt-1">
                      Available: {(Number(availablePoints) / 10000000).toFixed(2)} Points
                    </p>
                  </div>
                </div>

                {!exportedAuthEntryXDR ? (
                  <button
                    onClick={handlePrepareTransaction}
                    disabled={isBusy}
                    className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                  >
                    {loading ? 'Preparing...' : '🎴 Prepare & Export Auth Entry'}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                      <p className="text-xs font-bold uppercase tracking-wide text-green-700 mb-2">
                        Auth Entry XDR (Player 1 Signed)
                      </p>
                      <div className="bg-white p-3 rounded-lg border border-green-200 mb-3">
                        <code className="text-xs font-mono text-gray-700 break-all">
                          {exportedAuthEntryXDR}
                        </code>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={copyAuthEntryToClipboard}
                          className="py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold text-sm transition-all shadow-md"
                        >
                          {authEntryCopied ? '✓ Copied!' : '📋 Copy Auth Entry'}
                        </button>
                        <button
                          onClick={copyShareGameUrlWithAuthEntry}
                          className="py-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-bold text-sm transition-all shadow-md"
                        >
                          {shareUrlCopied ? '✓ Copied!' : '🔗 Share URL'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : createMode === 'import' ? (
              /* IMPORT MODE - Similar to NumberGuess but simplified for brevity */
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl">
                  <p className="text-sm font-semibold text-blue-800 mb-2">
                    📥 Import Auth Entry from Player 1
                  </p>
                  <div className="space-y-3">
                    <textarea
                      value={importAuthEntryXDR}
                      onChange={(e) => setImportAuthEntryXDR(e.target.value)}
                      placeholder="Paste Player 1's signed auth entry XDR here..."
                      rows={4}
                      className="w-full px-4 py-3 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 text-xs font-mono resize-none"
                    />
                    {xdrParseError && (
                      <p className="text-xs text-red-600 font-semibold">{xdrParseError}</p>
                    )}
                    {xdrParseSuccess && (
                      <p className="text-xs text-green-600 font-semibold">✓ Parsed successfully</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={importSessionId}
                        readOnly
                        placeholder="Session ID (auto)"
                        className="px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed"
                      />
                      <input
                        type="text"
                        value={importPlayer2Points}
                        onChange={(e) => setImportPlayer2Points(e.target.value)}
                        placeholder="Your points"
                        className="px-4 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 text-xs"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleImportTransaction}
                  disabled={isBusy || !importAuthEntryXDR.trim() || !importPlayer2Points.trim()}
                  className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-xl"
                >
                  {loading ? 'Importing & Signing...' : 'Import & Sign Auth Entry'}
                </button>
              </div>
            ) : (
              /* LOAD MODE */
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-xl">
                  <p className="text-sm font-semibold text-purple-800 mb-2">
                    🎮 Load Existing Game by Session ID
                  </p>
                  <input
                    type="text"
                    value={loadSessionId}
                    onChange={(e) => setLoadSessionId(e.target.value)}
                    placeholder="Enter session ID"
                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-purple-200 focus:outline-none focus:border-purple-400 text-sm font-mono"
                  />
                </div>
                <button
                  onClick={handleLoadExistingGame}
                  disabled={isBusy || !loadSessionId.trim()}
                  className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-xl"
                >
                  {loading ? 'Loading...' : '🎮 Load Game'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* PLAY PHASE - Table View */}
        {gamePhase === 'play' && gameState && (
          <div className="space-y-8">
            {/* Dealer/Opponent Area */}
            <div className="bg-green-900/50 backdrop-blur-sm rounded-2xl p-6 border-4 border-yellow-600/50">
              <div className="text-center mb-4">
                <div className="text-yellow-400 font-black text-2xl mb-2">
                  {isPlayer1 ? 'PLAYER 2' : 'PLAYER 1'}
                </div>
                <div className="text-white font-mono text-sm">
                  {isPlayer1 ? gameState.player2.slice(0, 8) + '...' + gameState.player2.slice(-4) :
                               gameState.player1.slice(0, 8) + '...' + gameState.player1.slice(-4)}
                </div>
                <div className="text-green-300 font-semibold text-sm mt-1">
                  Points: {isPlayer1 ? (Number(gameState.player2_points) / 10000000).toFixed(2) :
                                      (Number(gameState.player1_points) / 10000000).toFixed(2)}
                </div>
              </div>

              {/* Opponent's Hand */}
              <div className="flex justify-center gap-2 flex-wrap mb-4">
                {Array.from(isPlayer1 ? gameState.player2_hand : gameState.player1_hand).map((card, idx) => (
                  <PlayingCard key={idx} value={card} />
                ))}
              </div>

              {/* Opponent's Score */}
              <div className="text-center">
                <div className="inline-block px-6 py-3 rounded-full bg-white/20 backdrop-blur-sm">
                  <span className="text-yellow-400 font-black text-3xl">
                    {isPlayer1 ? (player2HandValue ?? '?') : (player1HandValue ?? '?')}
                  </span>
                </div>
                {(isPlayer1 ? gameState.player2_stuck : gameState.player1_stuck) && (
                  <div className="mt-2 inline-block px-4 py-2 rounded-full bg-red-500/90 text-white font-bold text-sm">
                    STUCK
                  </div>
                )}
              </div>
            </div>

            {/* Player Area */}
            <div className="bg-green-900/50 backdrop-blur-sm rounded-2xl p-6 border-4 border-yellow-600">
              <div className="text-center mb-4">
                <div className="text-yellow-400 font-black text-2xl mb-2">
                  YOU
                </div>
                <div className="text-white font-mono text-sm">
                  {userAddress.slice(0, 8) + '...' + userAddress.slice(-4)}
                </div>
                <div className="text-green-300 font-semibold text-sm mt-1">
                  Points: {isPlayer1 ? (Number(gameState.player1_points) / 10000000).toFixed(2) :
                                      (Number(gameState.player2_points) / 10000000).toFixed(2)}
                </div>
              </div>

              {/* Your Hand */}
              <div className="flex justify-center gap-2 flex-wrap mb-4">
                {Array.from(isPlayer1 ? gameState.player1_hand : gameState.player2_hand).map((card, idx) => (
                  <PlayingCard key={idx} value={card} />
                ))}
              </div>

              {/* Your Score */}
              <div className="text-center mb-6">
                <div className="inline-block px-6 py-3 rounded-full bg-white/20 backdrop-blur-sm">
                  <span className="text-yellow-400 font-black text-4xl">
                    {isPlayer1 ? (player1HandValue ?? '?') : (player2HandValue ?? '?')}
                  </span>
                </div>
                {(isPlayer1 ? gameState.player1_stuck : gameState.player2_stuck) && (
                  <div className="mt-2 inline-block px-4 py-2 rounded-full bg-red-500/90 text-white font-bold text-sm">
                    STUCK
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {canAct && (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={handleHit}
                    disabled={isBusy}
                    className="py-4 rounded-xl font-black text-2xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                  >
                    🎴 HIT
                  </button>
                  <button
                    onClick={handleStick}
                    disabled={isBusy}
                    className="py-4 rounded-xl font-black text-2xl text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 disabled:from-gray-400 disabled:to-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                  >
                    ✋ STICK
                  </button>
                </div>
              )}

              {!canAct && (
                <div className="text-center p-4 bg-blue-500/20 rounded-xl border-2 border-blue-400/50">
                  <p className="text-white font-semibold">
                    {(isPlayer1 ? gameState.player1_stuck : gameState.player2_stuck)
                      ? '✓ You stuck. Waiting for opponent...'
                      : 'Waiting for your turn...'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* REVEAL PHASE */}
        {gamePhase === 'reveal' && gameState && (
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl p-8 shadow-2xl text-center">
            <div className="text-7xl mb-4">🎊</div>
            <h3 className="text-3xl font-black text-gray-900 mb-3">
              Both Players Have Stuck!
            </h3>
            <p className="text-lg font-semibold text-gray-700 mb-6">
              Click below to reveal the winner
            </p>
            <button
              onClick={handleRevealWinner}
              disabled={isBusy}
              className="px-12 py-5 rounded-xl font-black text-white text-2xl bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-2xl hover:shadow-3xl transform hover:scale-105 disabled:transform-none"
            >
              {loading ? 'Revealing...' : '🏆 Reveal Winner'}
            </button>
          </div>
        )}

        {/* COMPLETE PHASE */}
        {gamePhase === 'complete' && gameState && (
          <div className="bg-white/95 backdrop-blur-xl rounded-2xl p-10 shadow-2xl text-center">
            <div className="text-8xl mb-6">🏆</div>
            <h3 className="text-4xl font-black text-gray-900 mb-6">
              Game Complete!
            </h3>

            {/* Final Scores */}
            <div className="grid grid-cols-2 gap-6 mb-8">
              <div className="p-6 bg-gray-100 rounded-xl">
                <div className="text-sm font-bold text-gray-600 mb-2">PLAYER 1</div>
                <div className="text-3xl font-black text-gray-900 mb-2">
                  {player1HandValue ?? '?'}
                </div>
                <div className="flex justify-center gap-1 flex-wrap">
                  {Array.from(gameState.player1_hand).map((card, idx) => (
                    <div key={idx} className="text-2xl">{card}</div>
                  ))}
                </div>
              </div>
              <div className="p-6 bg-gray-100 rounded-xl">
                <div className="text-sm font-bold text-gray-600 mb-2">PLAYER 2</div>
                <div className="text-3xl font-black text-gray-900 mb-2">
                  {player2HandValue ?? '?'}
                </div>
                <div className="flex justify-center gap-1 flex-wrap">
                  {Array.from(gameState.player2_hand).map((card, idx) => (
                    <div key={idx} className="text-2xl">{card}</div>
                  ))}
                </div>
              </div>
            </div>

            {gameState.winner && (
              <div className="p-6 bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-300 rounded-xl shadow-lg mb-6">
                <p className="text-sm font-bold uppercase tracking-wide text-gray-600 mb-2">Winner</p>
                <p className="font-mono text-lg font-bold text-gray-800">
                  {gameState.winner.slice(0, 8)}...{gameState.winner.slice(-4)}
                </p>
                {normalizeAddress(gameState.winner) === normalizedUserAddress && (
                  <p className="mt-3 text-green-700 font-black text-2xl">
                    🎉 You won!
                  </p>
                )}
              </div>
            )}

            <button
              onClick={onBack}
              className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 transition-all shadow-xl"
            >
              Back to Games
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
