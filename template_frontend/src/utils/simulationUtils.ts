import { StrKey } from '@stellar/stellar-sdk';
import { DEV_ADMIN_ADDRESS, DEV_PLAYER1_ADDRESS, DEV_PLAYER2_ADDRESS, NETWORK, RUNTIME_SIMULATION_SOURCE } from '@/utils/constants';

async function horizonAccountExists(address: string): Promise<boolean> {
  const horizonUrl =
    NETWORK === 'testnet'
      ? 'https://horizon-testnet.stellar.org'
      : NETWORK === 'mainnet'
      ? 'https://horizon.stellar.org'
      : null;

  if (!horizonUrl) return true;

  const res = await fetch(`${horizonUrl}/accounts/${address}`, { method: 'GET' });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon error ${res.status} checking account existence`);
  return true;
}

async function ensureTestnetAccountFunded(address: string): Promise<void> {
  if (NETWORK !== 'testnet') return;
  if (await horizonAccountExists(address)) return;

  const fundRes = await fetch(`https://friendbot.stellar.org?addr=${address}`, { method: 'GET' });
  if (!fundRes.ok) {
    throw new Error(`Friendbot funding failed (${fundRes.status}) for ${address}`);
  }

  // Give Horizon a moment to index
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    if (await horizonAccountExists(address)) return;
  }

  throw new Error(`Funded ${address} but it still doesn't appear on Horizon yet`);
}

export async function getSimulationSourceAddress(avoidAddresses: string[] = []): Promise<string> {
  const avoid = new Set(avoidAddresses.filter(Boolean));
  // Prefer explicit runtime config, then admin as it is most likely to exist (created/funded during deploy).
  const candidates = [
    RUNTIME_SIMULATION_SOURCE,
    DEV_ADMIN_ADDRESS,
    DEV_PLAYER2_ADDRESS,
    DEV_PLAYER1_ADDRESS,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (avoid.has(candidate)) continue;
    if (StrKey.isValidEd25519PublicKey(candidate)) return candidate;
  }

  throw new Error(
    'No valid on-chain account available to build/simulate this transaction. Run `bun run setup` to populate `VITE_DEV_*_ADDRESS`, or fund your connected wallet account.'
  );
}

export async function getFundedSimulationSourceAddress(avoidAddresses: string[] = []): Promise<string> {
  const addr = await getSimulationSourceAddress(avoidAddresses);
  await ensureTestnetAccountFunded(addr);
  return addr;
}
