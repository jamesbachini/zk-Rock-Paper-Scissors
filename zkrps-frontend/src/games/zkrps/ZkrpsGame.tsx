import { useEffect, useMemo, useState } from 'react';
import { rpc, StrKey } from '@stellar/stellar-sdk';
import { ZkrpsService } from './zkrpsService';
import { useWallet } from '@/hooks/useWallet';
import { FRIEND_BOT_AVAILABLE, FRIEND_BOT_URL, RPS_GAME_CONTRACT, RPC_URL } from '@/utils/constants';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import type { SessionData } from './bindings';
import {
  generateSalt,
  computeCommitment,
  generateProof,
  bigIntToBytes32,
  toHex,
} from './zkUtils';

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

const MOVE_OPTIONS = [
  { value: 0, label: 'Rock' },
  { value: 1, label: 'Paper' },
  { value: 2, label: 'Scissors' },
];

const moveLabel = (value: number | null | undefined) => {
  if (value === null || value === undefined) return 'Missing';
  return MOVE_OPTIONS.find((option) => option.value === value)?.label ?? `Move ${value}`;
};

const zkrpsService = new ZkrpsService(RPS_GAME_CONTRACT);

type StoredCommit = {
  salt: string;
  move: number;
  commitment: string;
  createdAt: string;
};

const storageKey = (sessionId: number, player: string) => `zkrps:rps:${sessionId}:${player}`;

const loadStoredCommit = (sessionId: number, player: string): StoredCommit | null => {
  if (!sessionId || !player || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(sessionId, player));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCommit;
    if (!parsed || !parsed.salt || parsed.move === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
};

const saveStoredCommit = (sessionId: number, player: string, data: StoredCommit) => {
  if (!sessionId || !player || typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey(sessionId, player), JSON.stringify(data));
};

interface ZkrpsGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

export function ZkrpsGame({
  userAddress,
  initialXDR,
  initialSessionId,
}: ZkrpsGameProps) {
  const { getContractSigner, walletType } = useWallet();
  const [sessionId, setSessionId] = useState<number>(() => initialSessionId || createRandomSessionId());
  const [sessionIdInput, setSessionIdInput] = useState('');
  const [player2Address, setPlayer2Address] = useState('');
  const [createMode, setCreateMode] = useState<'create' | 'join' | 'load'>('create');
  const [signedAuthEntry, setSignedAuthEntry] = useState<string>('');
  const [importAuthEntry, setImportAuthEntry] = useState('');
  const [parsedAuthEntry, setParsedAuthEntry] = useState<{ sessionId: number; player1: string } | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [latestLedger, setLatestLedger] = useState<number | null>(null);
  const [selectedMove, setSelectedMove] = useState<number | null>(null);
  const [storedCommit, setStoredCommit] = useState<StoredCommit | null>(null);
  const [loading, setLoading] = useState(false);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofStage, setProofStage] = useState<string | null>(null);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [funding, setFunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const rpcServer = useMemo(() => new rpc.Server(RPC_URL), []);

  useEffect(() => {
    setStoredCommit(loadStoredCommit(sessionId, userAddress));
  }, [sessionId, userAddress]);

  useEffect(() => {
    if (storedCommit) {
      setSelectedMove(storedCommit.move);
    }
  }, [storedCommit]);

  useEffect(() => {
    if (!importAuthEntry.trim()) {
      setParsedAuthEntry(null);
      return;
    }

    try {
      const parsed = zkrpsService.parseAuthEntry(importAuthEntry.trim());
      setParsedAuthEntry({ sessionId: parsed.sessionId, player1: parsed.player1 });
    } catch {
      setParsedAuthEntry(null);
    }
  }, [importAuthEntry]);

  useEffect(() => {
    if (!initialXDR) return;
    setImportAuthEntry(initialXDR);
    setCreateMode('join');
  }, [initialXDR]);

  useEffect(() => {
    setSignedAuthEntry('');
  }, [sessionId, player2Address]);

  const loadSession = async (id: number) => {
    const data = await zkrpsService.getSession(id);
    setSession(data);
  };

  const refreshLedger = async () => {
    try {
      const ledger = await rpcServer.getLatestLedger();
      setLatestLedger(ledger.sequence);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      if (!isMounted) return;
      await Promise.all([loadSession(sessionId), refreshLedger()]);
    };

    poll().catch(() => undefined);
    const interval = setInterval(() => {
      poll().catch(() => undefined);
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sessionId]);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
    setProofStage(null);
  };

  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  const isBusy = loading || proofLoading || quickstartLoading || funding;

  const handleQuickstart = async () => {
    resetMessages();
    try {
      setQuickstartLoading(true);

      if (walletType !== 'dev') {
        throw new Error('Quickstart only works with dev wallets.');
      }

      if (!quickstartAvailable) {
        throw new Error('Quickstart requires both dev wallets. Run "bun run setup" and connect a dev wallet.');
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
      setSessionIdInput(quickstartSessionId.toString());
      setPlayer2Address(player2AddressQuickstart);
      setCreateMode('load');
      setSignedAuthEntry('');
      setImportAuthEntry('');
      setParsedAuthEntry(null);

      const authEntry = await zkrpsService.prepareCreateSession(
        quickstartSessionId,
        player1AddressQuickstart,
        player2AddressQuickstart,
        player1Signer
      );

      const signedTx = await zkrpsService.importAndSignAuthEntry(
        authEntry,
        player2AddressQuickstart,
        player2Signer
      );

      await zkrpsService.finalizeCreateSession(
        signedTx,
        player2AddressQuickstart,
        player2Signer
      );

      await loadSession(quickstartSessionId);
      setSuccess('Quickstart complete! Session created with both dev wallets.');
    } catch (err) {
      console.error('Quickstart error:', err);
      setError(err instanceof Error ? err.message : 'Quickstart failed');
    } finally {
      setQuickstartLoading(false);
    }
  };

  const handleCreateSession = async () => {
    resetMessages();

    if (!StrKey.isValidEd25519PublicKey(player2Address)) {
      setError('Enter a valid Player 2 Stellar address.');
      return;
    }

    if (player2Address === userAddress) {
      setError('Player 2 must be a different address.');
      return;
    }

    if (!Number.isInteger(sessionId) || sessionId <= 0 || sessionId > 0xffffffff) {
      setError('Session ID must be a valid u32.');
      return;
    }

    try {
      setLoading(true);
      const signer = getContractSigner();
      const authEntry = await zkrpsService.prepareCreateSession(
        sessionId,
        userAddress,
        player2Address,
        signer
      );
      setSignedAuthEntry(authEntry);
      setSuccess('Signed auth entry generated. Share it with Player 2.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSession = async () => {
    resetMessages();

    if (!importAuthEntry.trim()) {
      setError('Paste the signed auth entry from Player 1.');
      return;
    }

    try {
      setLoading(true);
      const signer = getContractSigner();
      const xdr = await zkrpsService.importAndSignAuthEntry(
        importAuthEntry.trim(),
        userAddress,
        signer
      );
      await zkrpsService.finalizeCreateSession(xdr, userAddress, signer);

      const parsed = zkrpsService.parseAuthEntry(importAuthEntry.trim());
      setSessionId(parsed.sessionId);
      await loadSession(parsed.sessionId);
      setSuccess('Session created on-chain. You can now commit your move.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSession = async () => {
    resetMessages();

    const parsed = Number(sessionIdInput.trim());
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 0xffffffff) {
      setError('Enter a valid u32 session ID.');
      return;
    }

    setSessionId(parsed);
    await loadSession(parsed);
    setSuccess('Session loaded.');
  };

  const handleCommitMove = async () => {
    resetMessages();

    if (!session) {
      setError('Load a session first.');
      return;
    }

    if (!isPlayer) {
      setError('Only session players can commit a move.');
      return;
    }

    if (session.finalized) {
      setError('Session already finalized.');
      return;
    }

    if (!commitOpen) {
      setError(`Commit window closed at ledger ${commitDeadline ?? 'unknown'}.`);
      return;
    }

    if (playerCommitted) {
      setError('You already committed a move.');
      return;
    }

    if (selectedMove === null) {
      setError('Select a move before committing.');
      return;
    }

    try {
      setLoading(true);
      const signer = getContractSigner();
      const salt = generateSalt();
      const commitment = await computeCommitment(selectedMove, salt);
      const commitmentBytes = bigIntToBytes32(commitment);

      await zkrpsService.commitMove(sessionId, userAddress, commitmentBytes, signer);

      const commitRecord: StoredCommit = {
        salt: salt.toString(),
        move: selectedMove,
        commitment: commitment.toString(),
        createdAt: new Date().toISOString(),
      };
      saveStoredCommit(sessionId, userAddress, commitRecord);
      setStoredCommit(commitRecord);
      setSuccess('Move committed. Keep your salt safe for the reveal step.');
      await loadSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRevealMove = async () => {
    resetMessages();

    if (!session) {
      setError('Load a session first.');
      return;
    }

    if (!isPlayer) {
      setError('Only session players can reveal a move.');
      return;
    }

    if (session.finalized) {
      setError('Session already finalized.');
      return;
    }

    if (!playerCommitted) {
      setError('Commit your move before revealing.');
      return;
    }

    if (!revealOpen) {
      setError(`Reveal window closed at ledger ${revealDeadline ?? 'unknown'}.`);
      return;
    }

    if (playerRevealed) {
      setError('You already revealed.');
      return;
    }

    if (!storedCommit) {
      setError('Missing salt. Reveal is impossible without the stored salt.');
      return;
    }

    try {
      setProofLoading(true);
      setProofStage('Starting proof generation...');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const signer = getContractSigner();
      const salt = BigInt(storedCommit.salt);
      const proofData = await generateProof(
        {
          move: storedCommit.move,
          salt,
        },
        setProofStage
      );

      if (storedCommit.commitment && BigInt(storedCommit.commitment) !== proofData.commitment) {
        throw new Error('Stored commitment does not match generated proof.');
      }

      setProofStage('Submitting reveal transaction...');
      await zkrpsService.revealMove(
        sessionId,
        userAddress,
        proofData.proof,
        proofData.publicInputs,
        signer
      );

      setSuccess('Move revealed and proof verified on-chain.');
      await loadSession(sessionId);
    } catch (err) {
      console.error('Reveal failed:', err);
      setError(err instanceof Error ? err.message : 'Reveal failed');
    } finally {
      setProofLoading(false);
      setProofStage(null);
    }
  };

  const handleFinalize = async () => {
    resetMessages();

    if (!session) {
      setError('Load a session first.');
      return;
    }

    try {
      setLoading(true);
      const signer = getContractSigner();
      await zkrpsService.finalize(sessionId, userAddress, signer);
      setSuccess('Session finalized.');
      await loadSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalize failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFriendbot = async () => {
    resetMessages();

    if (!FRIEND_BOT_AVAILABLE || !FRIEND_BOT_URL) {
      setError('Friendbot is not configured for this network.');
      return;
    }

    try {
      setFunding(true);
      const separator = FRIEND_BOT_URL.includes('?') ? '&' : '?';
      const res = await fetch(`${FRIEND_BOT_URL}${separator}addr=${encodeURIComponent(userAddress)}`);
      if (!res.ok) {
        throw new Error(`Friendbot failed with status ${res.status}`);
      }
      setSuccess('Friendbot funding submitted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Friendbot funding failed');
    } finally {
      setFunding(false);
    }
  };

  const isPlayer1 = session?.player1 === userAddress;
  const isPlayer2 = session?.player2 === userAddress;
  const playerRole = isPlayer1 ? 'Player 1' : isPlayer2 ? 'Player 2' : 'Observer';
  const isPlayer = isPlayer1 || isPlayer2;

  const playerCommitment = isPlayer1
    ? session?.commit_p1
    : isPlayer2
      ? session?.commit_p2
      : null;
  const playerMove = isPlayer1
    ? session?.move_p1
    : isPlayer2
      ? session?.move_p2
      : null;
  const playerCommitted = playerCommitment !== null && playerCommitment !== undefined;
  const playerRevealed = playerMove !== null && playerMove !== undefined;

  const commitDeadline = session?.commit_deadline_ledger ?? null;
  const revealDeadline = session?.reveal_deadline_ledger ?? null;
  const nowLedger = latestLedger ?? null;
  const commitOpen = commitDeadline === null || nowLedger === null ? true : nowLedger <= commitDeadline;
  const revealOpen = revealDeadline === null || nowLedger === null ? true : nowLedger <= revealDeadline;
  const commitWindowLabel = commitDeadline === null || nowLedger === null ? 'Unknown' : commitOpen ? 'Open' : 'Closed';
  const revealWindowLabel = revealDeadline === null || nowLedger === null ? 'Unknown' : revealOpen ? 'Open' : 'Closed';

  const commitCountdown = commitDeadline !== null && nowLedger !== null
    ? Math.max(commitDeadline - nowLedger, 0)
    : null;
  const revealCountdown = revealDeadline !== null && nowLedger !== null
    ? Math.max(revealDeadline - nowLedger, 0)
    : null;

  const p1Committed = !!session?.commit_p1;
  const p2Committed = !!session?.commit_p2;
  const p1Revealed = session?.move_p1 !== null && session?.move_p1 !== undefined;
  const p2Revealed = session?.move_p2 !== null && session?.move_p2 !== undefined;

  const canFinalize = !!session && !session.finalized && (
    (p1Revealed && p2Revealed) ||
    (nowLedger !== null && commitDeadline !== null && nowLedger > commitDeadline && (p1Committed !== p2Committed)) ||
    (nowLedger !== null && revealDeadline !== null && nowLedger > revealDeadline)
  );

  const winnerLabel = useMemo(() => {
    if (!session || session.winner === null || session.winner === undefined) return null;
    if (session.winner === 0) return 'Tie';
    if (session.winner === 1) return `Player 1 (${session.player1})`;
    if (session.winner === 2) return `Player 2 (${session.player2})`;
    return 'Unknown';
  }, [session]);

  const commitDisabledReason = !session
    ? 'Load a session first.'
    : !isPlayer
      ? 'Only session players can commit.'
      : session.finalized
        ? 'Session already finalized.'
        : !commitOpen
          ? `Commit window closed at ledger ${commitDeadline ?? 'unknown'}.`
          : playerCommitted
            ? 'You already committed.'
            : selectedMove === null
              ? 'Select a move first.'
              : null;

  const revealDisabledReason = !session
    ? 'Load a session first.'
    : !isPlayer
      ? 'Only session players can reveal.'
      : session.finalized
        ? 'Session already finalized.'
        : !playerCommitted
          ? 'Commit your move before revealing.'
          : !storedCommit
            ? 'Missing salt. Reveal is impossible without it.'
            : playerRevealed
              ? 'You already revealed.'
              : !revealOpen
                ? `Reveal window closed at ledger ${revealDeadline ?? 'unknown'}.`
                : null;

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <div className="card">
        <h3 className="gradient-text">Session Setup</h3>
        <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
          Connected as {playerRole}. Use two browser profiles or devices to play against another wallet.
        </p>

        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {['create', 'join', 'load'].map((mode) => (
              <button
                key={mode}
                className={createMode === mode ? undefined : 'btn-secondary'}
                onClick={() => {
                  resetMessages();
                  setCreateMode(mode as typeof createMode);
                }}
                type="button"
              >
                {mode === 'create' ? 'Create Session' : mode === 'join' ? 'Join Session' : 'Load Session'}
              </button>
            ))}
          </div>

          <div
            className="notice info"
            style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}
          >
            <div>
              <strong>Quickstart (Dev)</strong>
              <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                Creates and signs a session with both dev wallets in one click.
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleQuickstart}
              disabled={isBusy || !quickstartAvailable}
            >
              {quickstartLoading ? 'Quickstarting...' : 'Quickstart Session'}
            </button>
          </div>

          {createMode === 'create' && (
            <div style={{ marginTop: '1.5rem' }}>
              <label>Session ID</label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <input
                  value={sessionId}
                  onChange={(event) => setSessionId(Number(event.target.value))}
                  type="number"
                  min={1}
                  max={0xffffffff}
                />
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setSessionId(createRandomSessionId())}
                >
                  Random
                </button>
              </div>

              <label style={{ marginTop: '1rem' }}>Player 2 Address</label>
              <input
                value={player2Address}
                onChange={(event) => setPlayer2Address(event.target.value.trim())}
                placeholder="G..."
              />

              <button
                type="button"
                onClick={handleCreateSession}
                disabled={loading}
                style={{ marginTop: '1rem' }}
              >
                {loading ? 'Preparing...' : 'Create & Export Auth Entry'}
              </button>

              {signedAuthEntry && (
                <div style={{ marginTop: '1rem' }}>
                  <label>Signed Auth Entry (share with Player 2)</label>
                  <textarea
                    value={signedAuthEntry}
                    readOnly
                    rows={4}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </div>
              )}
            </div>
          )}

          {createMode === 'join' && (
            <div style={{ marginTop: '1.5rem' }}>
              <label>Signed Auth Entry from Player 1</label>
              <textarea
                value={importAuthEntry}
                onChange={(event) => setImportAuthEntry(event.target.value)}
                rows={4}
              />

              {parsedAuthEntry && (
                <div className="notice info" style={{ marginTop: '1rem' }}>
                  Session {parsedAuthEntry.sessionId} created by {parsedAuthEntry.player1}.
                </div>
              )}

              <button
                type="button"
                onClick={handleJoinSession}
                disabled={loading}
                style={{ marginTop: '1rem' }}
              >
                {loading ? 'Submitting...' : 'Sign & Submit'}
              </button>
            </div>
          )}

          {createMode === 'load' && (
            <div style={{ marginTop: '1.5rem' }}>
              <label>Session ID</label>
              <input
                value={sessionIdInput}
                onChange={(event) => setSessionIdInput(event.target.value)}
                placeholder="Session ID"
              />
              <button
                type="button"
                onClick={handleLoadSession}
                style={{ marginTop: '1rem' }}
              >
                Load Session
              </button>
            </div>
          )}
        </div>

        {FRIEND_BOT_AVAILABLE && (
          <button
            className="btn-secondary"
            type="button"
            onClick={handleFriendbot}
            disabled={funding}
            style={{ marginTop: '1.5rem' }}
          >
            {funding ? 'Funding...' : 'Fund Connected Wallet (Friendbot)'}
          </button>
        )}

        {error && <div className="notice error" style={{ marginTop: '1rem' }}>{error}</div>}
        {success && <div className="notice success" style={{ marginTop: '1rem' }}>{success}</div>}
      </div>

      <div className="card">
        <h3 className="gradient-text">Session Status</h3>
        {session ? (
          <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
            <div><strong>Session ID:</strong> {sessionId}</div>
            <div><strong>Player 1:</strong> {session.player1}</div>
            <div><strong>Player 2:</strong> {session.player2}</div>
            <div><strong>Current Ledger:</strong> {latestLedger ?? '...'}</div>
            <div><strong>Commit Deadline:</strong> {commitDeadline ?? '...'}</div>
            <div><strong>Reveal Deadline:</strong> {revealDeadline ?? '...'}</div>
            <div><strong>Commit Window:</strong> {commitWindowLabel}</div>
            <div><strong>Reveal Window:</strong> {revealWindowLabel}</div>
            {commitCountdown !== null && (
              <div><strong>Commit Window Closes In:</strong> {commitCountdown} ledgers</div>
            )}
            {revealCountdown !== null && (
              <div><strong>Reveal Window Closes In:</strong> {revealCountdown} ledgers</div>
            )}
            <div><strong>Player 1 Commit:</strong> {p1Committed ? 'Submitted' : 'Missing'}</div>
            <div><strong>Player 2 Commit:</strong> {p2Committed ? 'Submitted' : 'Missing'}</div>
            <div><strong>Player 1 Reveal:</strong> {moveLabel(session.move_p1)}</div>
            <div><strong>Player 2 Reveal:</strong> {moveLabel(session.move_p2)}</div>
            <div><strong>Your Commit:</strong> {isPlayer ? (playerCommitted ? 'Submitted' : 'Missing') : 'N/A'}</div>
            <div><strong>Your Reveal:</strong> {isPlayer ? moveLabel(playerMove) : 'N/A'}</div>
            <div><strong>Finalized:</strong> {session.finalized ? 'Yes' : 'No'}</div>
            {winnerLabel && <div><strong>Winner:</strong> {winnerLabel}</div>}
          </div>
        ) : (
          <p style={{ marginTop: '1rem', color: 'var(--color-ink-muted)' }}>
            No session loaded yet.
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="gradient-text">Commit Move</h3>
        <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
          Choose your move and commit it. A random salt is generated locally.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          {MOVE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={selectedMove === option.value ? undefined : 'btn-secondary'}
              type="button"
              onClick={() => setSelectedMove(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleCommitMove}
          disabled={loading || !!commitDisabledReason}
          style={{ marginTop: '1rem' }}
        >
          {loading ? 'Submitting...' : 'Commit Move'}
        </button>

        {commitDisabledReason && (
          <div className="notice info" style={{ marginTop: '1rem' }}>
            {commitDisabledReason}
          </div>
        )}

        {storedCommit && (
          <div className="notice info" style={{ marginTop: '1rem' }}>
            Salt saved locally. Keep it safe or you cannot reveal. Salt: {toHex(BigInt(storedCommit.salt))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="gradient-text">Reveal Move</h3>
        <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
          Generate an Ultrahonk proof in your browser and submit it to reveal your move.
        </p>

        {storedCommit ? (
          <div style={{ marginTop: '1rem' }}>
            <div><strong>Stored Move:</strong> {moveLabel(storedCommit.move)}</div>
            <div style={{ marginTop: '0.5rem' }}><strong>Commitment:</strong> {toHex(BigInt(storedCommit.commitment))}</div>
          </div>
        ) : (
          <div className="notice error" style={{ marginTop: '1rem' }}>
            Missing salt. If you cleared storage, you cannot reveal this session.
          </div>
        )}

        <button
          type="button"
          onClick={handleRevealMove}
          disabled={proofLoading || !!revealDisabledReason}
          style={{ marginTop: '1rem' }}
        >
          {proofLoading ? 'Generating Proof...' : 'Reveal With Proof'}
        </button>

        {proofStage && (
          <div className="notice info" style={{ marginTop: '1rem' }}>
            {proofStage}
          </div>
        )}

        {revealDisabledReason && (
          <div className="notice info" style={{ marginTop: '1rem' }}>
            {revealDisabledReason}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="gradient-text">Finalize</h3>
        <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
          Finalize once both players reveal, or after deadlines for forfeits.
        </p>
        <button
          type="button"
          onClick={handleFinalize}
          disabled={!canFinalize || loading}
          style={{ marginTop: '1rem' }}
        >
          {loading ? 'Finalizing...' : 'Finalize Session'}
        </button>

        <div className="notice info" style={{ marginTop: '1rem' }}>
          Forfeits: if only one player commits by the commit deadline, the other forfeits. If both commit but
          only one reveals by the reveal deadline, the non-revealer forfeits. If neither reveals by the reveal
          deadline, the result is a tie.
        </div>
      </div>
    </div>
  );
}
