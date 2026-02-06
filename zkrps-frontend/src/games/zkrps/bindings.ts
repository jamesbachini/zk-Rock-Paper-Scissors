import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"SessionAlreadyExists"},
  4: {message:"SessionNotFound"},
  5: {message:"NotPlayer"},
  6: {message:"CommitWindowClosed"},
  7: {message:"RevealWindowClosed"},
  8: {message:"AlreadyCommitted"},
  9: {message:"AlreadyRevealed"},
  10: {message:"CommitRequired"},
  11: {message:"InvalidMove"},
  12: {message:"AlreadyFinalized"},
  13: {message:"FinalizeNotReady"},
  14: {message:"InvalidState"},
  15: {message:"SamePlayer"},
  16: {message:"InvalidPublicInputs"},
  17: {message:"ProofVerificationFailed"},
  18: {message:"CommitmentMismatch"}
}


export interface Config {
  commit_window: u32;
  game_hub: string;
  reveal_window: u32;
  verifier: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Session", values: readonly [u32]};



export interface SessionData {
  commit_deadline_ledger: u32;
  commit_p1: Option<Buffer>;
  commit_p2: Option<Buffer>;
  created_ledger: u32;
  finalized: boolean;
  move_p1: Option<u32>;
  move_p2: Option<u32>;
  player1: string;
  player2: string;
  reveal_deadline_ledger: u32;
  winner: Option<u32>;
}




export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time initialization. Stores GameHub + verifier addresses and timing windows.
   */
  init: ({game_hub, verifier, commit_window, reveal_window}: {game_hub: string, verifier: string, commit_window: u32, reveal_window: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a finalize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Finalize the session based on reveals or forfeit deadlines.
   */
  finalize: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only helper to fetch a player's revealed move (if any).
   */
  get_move: ({session_id, player}: {session_id: u32, player: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Option<u32>>>>

  /**
   * Construct and simulate a commit_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Commit a move hash for the player.
   */
  commit_move: ({session_id, player, commitment}: {session_id: u32, player: string, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the session state (for UI polling).
   */
  get_session: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SessionData>>>

  /**
   * Construct and simulate a reveal_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reveal a move by submitting an Ultrahonk proof and public inputs.
   */
  reveal_move: ({session_id, player, proof, public_inputs}: {session_id: u32, player: string, proof: Buffer, public_inputs: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new session between two players and call GameHub.start_game.
   */
  create_session: ({session_id, player1, player2}: {session_id: u32, player1: string, player2: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_commitment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only helper to fetch a player's commitment (if any).
   */
  get_commitment: ({session_id, player}: {session_id: u32, player: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Option<Buffer>>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAEgAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAUU2Vzc2lvbkFscmVhZHlFeGlzdHMAAAADAAAAAAAAAA9TZXNzaW9uTm90Rm91bmQAAAAABAAAAAAAAAAJTm90UGxheWVyAAAAAAAABQAAAAAAAAASQ29tbWl0V2luZG93Q2xvc2VkAAAAAAAGAAAAAAAAABJSZXZlYWxXaW5kb3dDbG9zZWQAAAAAAAcAAAAAAAAAEEFscmVhZHlDb21taXR0ZWQAAAAIAAAAAAAAAA9BbHJlYWR5UmV2ZWFsZWQAAAAACQAAAAAAAAAOQ29tbWl0UmVxdWlyZWQAAAAAAAoAAAAAAAAAC0ludmFsaWRNb3ZlAAAAAAsAAAAAAAAAEEFscmVhZHlGaW5hbGl6ZWQAAAAMAAAAAAAAABBGaW5hbGl6ZU5vdFJlYWR5AAAADQAAAAAAAAAMSW52YWxpZFN0YXRlAAAADgAAAAAAAAAKU2FtZVBsYXllcgAAAAAADwAAAAAAAAATSW52YWxpZFB1YmxpY0lucHV0cwAAAAAQAAAAAAAAABdQcm9vZlZlcmlmaWNhdGlvbkZhaWxlZAAAAAARAAAAAAAAABJDb21taXRtZW50TWlzbWF0Y2gAAAAAABI=",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABAAAAAAAAAANY29tbWl0X3dpbmRvdwAAAAAAAAQAAAAAAAAACGdhbWVfaHViAAAAEwAAAAAAAAANcmV2ZWFsX3dpbmRvdwAAAAAAAAQAAAAAAAAACHZlcmlmaWVyAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAQAAAAAAAAAHU2Vzc2lvbgAAAAABAAAABA==",
        "AAAABQAAAAAAAAAAAAAACUZpbmFsaXplZAAAAAAAAAEAAAAJZmluYWxpemVkAAAAAAAAAgAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAAAAAABndpbm5lcgAAAAAABAAAAAAAAAAC",
        "AAAAAQAAAAAAAAAAAAAAC1Nlc3Npb25EYXRhAAAAAAsAAAAAAAAAFmNvbW1pdF9kZWFkbGluZV9sZWRnZXIAAAAAAAQAAAAAAAAACWNvbW1pdF9wMQAAAAAAA+gAAAPuAAAAIAAAAAAAAAAJY29tbWl0X3AyAAAAAAAD6AAAA+4AAAAgAAAAAAAAAA5jcmVhdGVkX2xlZGdlcgAAAAAABAAAAAAAAAAJZmluYWxpemVkAAAAAAAAAQAAAAAAAAAHbW92ZV9wMQAAAAPoAAAABAAAAAAAAAAHbW92ZV9wMgAAAAPoAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAAFnJldmVhbF9kZWFkbGluZV9sZWRnZXIAAAAAAAQAAAAAAAAABndpbm5lcgAAAAAD6AAAAAQ=",
        "AAAABQAAAAAAAAAAAAAADE1vdmVSZXZlYWxlZAAAAAEAAAANbW92ZV9yZXZlYWxlZAAAAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAAAAAAAAVtb3ZlXwAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADU1vdmVDb21taXR0ZWQAAAAAAAABAAAADm1vdmVfY29tbWl0dGVkAAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlNlc3Npb25DcmVhdGVkAAAAAAABAAAAD3Nlc3Npb25fY3JlYXRlZAAAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAAI=",
        "AAAAAAAAAFBPbmUtdGltZSBpbml0aWFsaXphdGlvbi4gU3RvcmVzIEdhbWVIdWIgKyB2ZXJpZmllciBhZGRyZXNzZXMgYW5kIHRpbWluZyB3aW5kb3dzLgAAAARpbml0AAAABAAAAAAAAAAIZ2FtZV9odWIAAAATAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAAAAAADWNvbW1pdF93aW5kb3cAAAAAAAAEAAAAAAAAAA1yZXZlYWxfd2luZG93AAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADtGaW5hbGl6ZSB0aGUgc2Vzc2lvbiBiYXNlZCBvbiByZXZlYWxzIG9yIGZvcmZlaXQgZGVhZGxpbmVzLgAAAAAIZmluYWxpemUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAADxSZWFkLW9ubHkgaGVscGVyIHRvIGZldGNoIGEgcGxheWVyJ3MgcmV2ZWFsZWQgbW92ZSAoaWYgYW55KS4AAAAIZ2V0X21vdmUAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAABAAAD6QAAA+gAAAAEAAAAAw==",
        "AAAAAAAAACJDb21taXQgYSBtb3ZlIGhhc2ggZm9yIHRoZSBwbGF5ZXIuAAAAAAALY29tbWl0X21vdmUAAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAACdHZXQgdGhlIHNlc3Npb24gc3RhdGUgKGZvciBVSSBwb2xsaW5nKS4AAAAAC2dldF9zZXNzaW9uAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAABAAAD6QAAB9AAAAALU2Vzc2lvbkRhdGEAAAAAAw==",
        "AAAAAAAAAEFSZXZlYWwgYSBtb3ZlIGJ5IHN1Ym1pdHRpbmcgYW4gVWx0cmFob25rIHByb29mIGFuZCBwdWJsaWMgaW5wdXRzLgAAAAAAAAtyZXZlYWxfbW92ZQAAAAAEAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAABXByb29mAAAAAAAADgAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAAA4AAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAEVDcmVhdGUgYSBuZXcgc2Vzc2lvbiBiZXR3ZWVuIHR3byBwbGF5ZXJzIGFuZCBjYWxsIEdhbWVIdWIuc3RhcnRfZ2FtZS4AAAAAAAAOY3JlYXRlX3Nlc3Npb24AAAAAAAMAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAADlSZWFkLW9ubHkgaGVscGVyIHRvIGZldGNoIGEgcGxheWVyJ3MgY29tbWl0bWVudCAoaWYgYW55KS4AAAAAAAAOZ2V0X2NvbW1pdG1lbnQAAAAAAAIAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAEAAAPpAAAD6AAAA+4AAAAgAAAAAw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<Result<void>>,
        finalize: this.txFromJSON<Result<void>>,
        get_move: this.txFromJSON<Result<Option<u32>>>,
        commit_move: this.txFromJSON<Result<void>>,
        get_session: this.txFromJSON<Result<SessionData>>,
        reveal_move: this.txFromJSON<Result<void>>,
        create_session: this.txFromJSON<Result<void>>,
        get_commitment: this.txFromJSON<Result<Option<Buffer>>>
  }
}