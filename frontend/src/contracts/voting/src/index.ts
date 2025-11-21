import { Buffer } from "buffer";
import { Address } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
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
  Typepoint,
  Duration,
} from '@stellar/stellar-sdk/contract';
export * from '@stellar/stellar-sdk'
export * as contract from '@stellar/stellar-sdk/contract'
export * as rpc from '@stellar/stellar-sdk/rpc'

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export type DataKey = {tag: "Proposal", values: readonly [u64, u64]} | {tag: "ProposalCount", values: readonly [u64]} | {tag: "Nullifier", values: readonly [u64, u64, u256]} | {tag: "VotingKey", values: readonly [u64]};


export interface ProposalInfo {
  created_by: string;
  dao_id: u64;
  description: string;
  eligible_root: u256;
  end_time: u64;
  id: u64;
  no_votes: u64;
  vk_hash: Buffer;
  yes_votes: u64;
}


/**
 * Groth16 Verification Key for BN254
 */
export interface VerificationKey {
  alpha: Buffer;
  beta: Buffer;
  delta: Buffer;
  gamma: Buffer;
  ic: Array<Buffer>;
}


/**
 * Groth16 Proof
 */
export interface Proof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}




export interface Client {
  /**
   * Construct and simulate a set_vk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set verification key for a DAO (admin only)
   */
  set_vk: ({dao_id, vk, admin}: {dao_id: u64, vk: VerificationKey, admin: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_vk_from_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set verification key from registry during DAO initialization
   * This function is called by the registry contract during create_and_init_dao
   * to avoid re-entrancy issues. The registry is a trusted system contract.
   */
  set_vk_from_registry: ({dao_id, vk}: {dao_id: u64, vk: VerificationKey}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new proposal for a DAO
   * Voting starts immediately upon creation (Merkle root snapshot taken now)
   * end_time: Unix timestamp for when voting closes (must be in the future)
   */
  create_proposal: ({dao_id, description, end_time, creator}: {dao_id: u64, description: string, end_time: u64, creator: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a vote transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit a vote with ZK proof
   */
  vote: ({dao_id, proposal_id, vote_choice, nullifier, root, proof}: {dao_id: u64, proposal_id: u64, vote_choice: boolean, nullifier: u256, root: u256, proof: Proof}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get proposal info
   */
  get_proposal: ({dao_id, proposal_id}: {dao_id: u64, proposal_id: u64}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<ProposalInfo>>

  /**
   * Construct and simulate a proposal_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get proposal count for a DAO
   */
  proposal_count: ({dao_id}: {dao_id: u64}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a is_nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if nullifier has been used
   */
  is_nullifier_used: ({dao_id, proposal_id, nullifier}: {dao_id: u64, proposal_id: u64, nullifier: u256}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a tree_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get tree contract address
   */
  tree_contract: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_results transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get results for a proposal (yes_votes, no_votes)
   */
  get_results: ({dao_id, proposal_id}: {dao_id: u64, proposal_id: u64}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<readonly [u64, u64]>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {tree_contract}: {tree_contract: string},
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
    return ContractClient.deploy({tree_contract}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAAAAAACFByb3Bvc2FsAAAAAgAAAAYAAAAGAAAAAQAAAAAAAAANUHJvcG9zYWxDb3VudAAAAAAAAAEAAAAGAAAAAQAAAAAAAAAJTnVsbGlmaWVyAAAAAAAAAwAAAAYAAAAGAAAADAAAAAEAAAAAAAAACVZvdGluZ0tleQAAAAAAAAEAAAAG",
        "AAAAAQAAAAAAAAAAAAAADFByb3Bvc2FsSW5mbwAAAAkAAAAAAAAACmNyZWF0ZWRfYnkAAAAAABMAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAANZWxpZ2libGVfcm9vdAAAAAAAAAwAAAAAAAAACGVuZF90aW1lAAAABgAAAAAAAAACaWQAAAAAAAYAAAAAAAAACG5vX3ZvdGVzAAAABgAAAAAAAAAHdmtfaGFzaAAAAAPuAAAAIAAAAAAAAAAJeWVzX3ZvdGVzAAAAAAAABg==",
        "AAAAAQAAACJHcm90aDE2IFZlcmlmaWNhdGlvbiBLZXkgZm9yIEJOMjU0AAAAAAAAAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAFAAAAAAAAAAVhbHBoYQAAAAAAA+4AAABAAAAAAAAAAARiZXRhAAAD7gAAAIAAAAAAAAAABWRlbHRhAAAAAAAD7gAAAIAAAAAAAAAABWdhbW1hAAAAAAAD7gAAAIAAAAAAAAAAAmljAAAAAAPqAAAD7gAAAEA=",
        "AAAAAQAAAA1Hcm90aDE2IFByb29mAAAAAAAAAAAAAAVQcm9vZgAAAAAAAAMAAAAAAAAAAWEAAAAAAAPuAAAAQAAAAAAAAAABYgAAAAAAA+4AAACAAAAAAAAAAAFjAAAAAAAD7gAAAEA=",
        "AAAABQAAAAAAAAAAAAAAClZLU2V0RXZlbnQAAAAAAAEAAAAMdmtfc2V0X2V2ZW50AAAAAQAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAQAAAAI=",
        "AAAABQAAAAAAAAAAAAAADVByb3Bvc2FsRXZlbnQAAAAAAAABAAAADnByb3Bvc2FsX2V2ZW50AAAAAAAEAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACVZvdGVFdmVudAAAAAAAAAEAAAAKdm90ZV9ldmVudAAAAAAABAAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAAAAAABmNob2ljZQAAAAAAAQAAAAAAAAAAAAAACW51bGxpZmllcgAAAAAAAAwAAAAAAAAAAg==",
        "AAAAAAAAADxDb25zdHJ1Y3RvcjogSW5pdGlhbGl6ZSBjb250cmFjdCB3aXRoIE1lbWJlcnNoaXBUcmVlIGFkZHJlc3MAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAADXRyZWVfY29udHJhY3QAAAAAAAATAAAAAA==",
        "AAAAAAAAACtTZXQgdmVyaWZpY2F0aW9uIGtleSBmb3IgYSBEQU8gKGFkbWluIG9ubHkpAAAAAAZzZXRfdmsAAAAAAAMAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAACdmsAAAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAANBTZXQgdmVyaWZpY2F0aW9uIGtleSBmcm9tIHJlZ2lzdHJ5IGR1cmluZyBEQU8gaW5pdGlhbGl6YXRpb24KVGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgYnkgdGhlIHJlZ2lzdHJ5IGNvbnRyYWN0IGR1cmluZyBjcmVhdGVfYW5kX2luaXRfZGFvCnRvIGF2b2lkIHJlLWVudHJhbmN5IGlzc3Vlcy4gVGhlIHJlZ2lzdHJ5IGlzIGEgdHJ1c3RlZCBzeXN0ZW0gY29udHJhY3QuAAAAFHNldF92a19mcm9tX3JlZ2lzdHJ5AAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAJ2awAAAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAA==",
        "AAAAAAAAALBDcmVhdGUgYSBuZXcgcHJvcG9zYWwgZm9yIGEgREFPClZvdGluZyBzdGFydHMgaW1tZWRpYXRlbHkgdXBvbiBjcmVhdGlvbiAoTWVya2xlIHJvb3Qgc25hcHNob3QgdGFrZW4gbm93KQplbmRfdGltZTogVW5peCB0aW1lc3RhbXAgZm9yIHdoZW4gdm90aW5nIGNsb3NlcyAobXVzdCBiZSBpbiB0aGUgZnV0dXJlKQAAAA9jcmVhdGVfcHJvcG9zYWwAAAAABAAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAhlbmRfdGltZQAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAEAAAAG",
        "AAAAAAAAABtTdWJtaXQgYSB2b3RlIHdpdGggWksgcHJvb2YAAAAABHZvdGUAAAAGAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAAC3ZvdGVfY2hvaWNlAAAAAAEAAAAAAAAACW51bGxpZmllcgAAAAAAAAwAAAAAAAAABHJvb3QAAAAMAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAFUHJvb2YAAAAAAAAA",
        "AAAAAAAAABFHZXQgcHJvcG9zYWwgaW5mbwAAAAAAAAxnZXRfcHJvcG9zYWwAAAACAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAH0AAAAAxQcm9wb3NhbEluZm8=",
        "AAAAAAAAABxHZXQgcHJvcG9zYWwgY291bnQgZm9yIGEgREFPAAAADnByb3Bvc2FsX2NvdW50AAAAAAABAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAABg==",
        "AAAAAAAAACBDaGVjayBpZiBudWxsaWZpZXIgaGFzIGJlZW4gdXNlZAAAABFpc19udWxsaWZpZXJfdXNlZAAAAAAAAAMAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAAAAAAJbnVsbGlmaWVyAAAAAAAADAAAAAEAAAAB",
        "AAAAAAAAABlHZXQgdHJlZSBjb250cmFjdCBhZGRyZXNzAAAAAAAADXRyZWVfY29udHJhY3QAAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAADBHZXQgcmVzdWx0cyBmb3IgYSBwcm9wb3NhbCAoeWVzX3ZvdGVzLCBub192b3RlcykAAAALZ2V0X3Jlc3VsdHMAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAA+0AAAACAAAABgAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    set_vk: this.txFromJSON<null>,
        set_vk_from_registry: this.txFromJSON<null>,
        create_proposal: this.txFromJSON<u64>,
        vote: this.txFromJSON<null>,
        get_proposal: this.txFromJSON<ProposalInfo>,
        proposal_count: this.txFromJSON<u64>,
        is_nullifier_used: this.txFromJSON<boolean>,
        tree_contract: this.txFromJSON<string>,
        get_results: this.txFromJSON<readonly [u64, u64]>
  }
}