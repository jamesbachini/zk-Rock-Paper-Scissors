/**
 * Auth Entry utilities for multi-sig transaction flows
 */

import { Buffer } from 'buffer';
import { xdr, Address, authorizeEntry } from '@stellar/stellar-sdk';
import { contract } from '@stellar/stellar-sdk';
import { calculateValidUntilLedger } from './ledgerUtils';
import { DEFAULT_AUTH_TTL_MINUTES } from './constants';

/**
 * Inject a signed auth entry from Player 1 into Player 2's transaction
 * Used in multi-sig flows where Player 1 has pre-signed an auth entry
 *
 * @param tx - The assembled transaction from Player 2
 * @param player1AuthEntryXDR - Player 1's signed auth entry in XDR format
 * @param player2Address - Player 2's address
 * @param player2Signer - Player 2's signing functions
 * @returns Updated transaction with both auth entries signed
 */
export async function injectSignedAuthEntry(
  tx: contract.AssembledTransaction<any>,
  player1AuthEntryXDR: string,
  player2Address: string,
  player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  validUntilLedgerSeq?: number
): Promise<contract.AssembledTransaction<any>> {
  // Parse Player 1's signed auth entry
  const player1SignedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(
    player1AuthEntryXDR,
    'base64'
  );
  const player1SignedAddress = player1SignedAuthEntry.credentials().address().address();
  const player1AddressString = Address.fromScAddress(player1SignedAddress).toString();

  // Get the simulation data
  if (!tx.simulationData?.result?.auth) {
    throw new Error('No auth entries found in transaction simulation');
  }

  const authEntries = tx.simulationData.result.auth;
  console.log('[injectSignedAuthEntry] Found', authEntries.length, 'auth entries');

  // Find Player 1's stub entry and Player 2's entry
  let player1StubIndex = -1;
  let player2AuthEntry: xdr.SorobanAuthorizationEntry | null = null;
  let player2Index = -1;

  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    try {
      const credentialType = entry.credentials().switch().name;

      // Note: the invoker (transaction source) may show up as `sorobanCredentialsSourceAccount`,
      // which does NOT require an auth entry signature (it is authorized by the envelope signature).
      if (credentialType === 'sorobanCredentialsAddress') {
        const entryAddress = entry.credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();

        if (entryAddressString === player1AddressString) {
          player1StubIndex = i;
          console.log(`[injectSignedAuthEntry] Found Player 1 stub at index ${i}`);
        } else if (entryAddressString === player2Address) {
          player2AuthEntry = entry;
          player2Index = i;
          console.log(`[injectSignedAuthEntry] Found Player 2 auth entry at index ${i}`);
        }
      } else {
        console.log(`[injectSignedAuthEntry] Skipping non-address credentials at index ${i}: ${credentialType}`);
      }
    } catch (err) {
      console.error('[injectSignedAuthEntry] Error processing auth entry:', err);
      continue;
    }
  }

  if (player1StubIndex === -1) {
    throw new Error('Could not find Player 1 stub entry in transaction');
  }

  if (!player2AuthEntry) {
    console.log(
      `[injectSignedAuthEntry] No address-based auth entry found for Player 2 (${player2Address}); assuming Player 2 is the invoker/source account and does not require an auth entry signature`
    );
  }

  // Replace Player 1's stub with their signed entry
  authEntries[player1StubIndex] = player1SignedAuthEntry;
  console.log('[injectSignedAuthEntry] Replaced Player 1 stub with signed entry');

  // Sign Player 2's auth entry (only if Player 2 appears as a non-invoker address auth entry)
  if (player2AuthEntry && player2Index !== -1) {
    console.log('[injectSignedAuthEntry] Signing Player 2 auth entry');

    if (!player2Signer.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    const authValidUntilLedgerSeq =
      validUntilLedgerSeq ??
      (await calculateValidUntilLedger(tx.options.rpcUrl, DEFAULT_AUTH_TTL_MINUTES));

    const player2SignedAuthEntry = await authorizeEntry(
      player2AuthEntry,
      async (preimage) => {
        console.log('[injectSignedAuthEntry] Signing Player 2 preimage...');

        if (!player2Signer.signAuthEntry) {
          throw new Error('Wallet does not support auth entry signing');
        }

        const signResult = await player2Signer.signAuthEntry(preimage.toXDR('base64'), {
          networkPassphrase: tx.options.networkPassphrase,
          address: player2Address,
        });

        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }

        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      authValidUntilLedgerSeq,
      tx.options.networkPassphrase
    );

    // Replace Player 2's stub with their signed entry
    authEntries[player2Index] = player2SignedAuthEntry;
    console.log('[injectSignedAuthEntry] Signed Player 2 auth entry');
  }

  // Update the transaction's auth entries
  tx.simulationData.result.auth = authEntries;

  return tx;
}
