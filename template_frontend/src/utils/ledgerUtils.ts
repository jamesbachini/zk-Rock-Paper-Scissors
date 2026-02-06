/**
 * Ledger utility functions
 */

import { rpc } from '@stellar/stellar-sdk';

/**
 * Calculate a future ledger sequence number based on TTL in minutes
 * @param rpcUrl - The RPC URL to use
 * @param ttlMinutes - Time to live in minutes
 * @returns Future ledger sequence number
 */
export async function calculateValidUntilLedger(
  rpcUrl: string,
  ttlMinutes: number
): Promise<number> {
  const server = new rpc.Server(rpcUrl);
  const latestLedger = await server.getLatestLedger();

  // Stellar ledgers close approximately every 5 seconds
  const LEDGERS_PER_MINUTE = 12; // 60 seconds / 5 seconds per ledger
  const ledgersToAdd = Math.ceil(ttlMinutes * LEDGERS_PER_MINUTE);

  return latestLedger.sequence + ledgersToAdd;
}
