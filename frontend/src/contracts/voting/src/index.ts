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


export const networks = {
  futurenet: {
    networkPassphrase: "Test SDF Future Network ; October 2022",
    contractId: "CDPESUHCS2J3SQQ5HWJXJYXENJ4UUOJYD52MRKRIQJXI6LBLKQUCX2YE",
  }
} as const


/**
 * Groth16 Proof
 */
export interface Proof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}

export type DataKey = {tag: "Proposal", values: readonly [u64, u64]} | {tag: "ProposalCount", values: readonly [u64]} | {tag: "Nullifier", values: readonly [u64, u64, u256]} | {tag: "VotingKey", values: readonly [u64]} | {tag: "VkVersion", values: readonly [u64]} | {tag: "VkByVersion", values: readonly [u64, u32]} | {tag: "VerifyOverride", values: void};

export type VoteMode = {tag: "Fixed", values: void} | {tag: "Trailing", values: void};



export const VotingError = {
  1: {message:"NotAdmin"},
  19: {message:"Unauthorized"},
  2: {message:"VkIcLengthMismatch"},
  3: {message:"VkIcTooLarge"},
  4: {message:"DescriptionTooLong"},
  5: {message:"NotDaoMember"},
  6: {message:"EndTimeInvalid"},
  7: {message:"NullifierUsed"},
  8: {message:"VotingClosed"},
  9: {message:"CommitmentRevokedAtCreation"},
  10: {message:"CommitmentRevokedDuringVoting"},
  11: {message:"RootMismatch"},
  12: {message:"RootNotInHistory"},
  13: {message:"RootPredatesProposal"},
  14: {message:"VkChanged"},
  15: {message:"InvalidProof"},
  16: {message:"VkNotSet"},
  17: {message:"VkVersionMismatch"},
  18: {message:"AlreadyInitialized"},
  20: {message:"InvalidState"}
}


export interface ProposalInfo {
  created_at: u64;
  created_by: string;
  dao_id: u64;
  description: string;
  earliest_root_index: u32;
  eligible_root: u256;
  end_time: u64;
  id: u64;
  no_votes: u64;
  state: ProposalState;
  vk_hash: Buffer;
  vk_version: u32;
  vote_mode: VoteMode;
  yes_votes: u64;
}

export type ProposalState = {tag: "Active", values: void} | {tag: "Closed", values: void} | {tag: "Archived", values: void};



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




export interface Client {
  /**
   * Construct and simulate a vote transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit a vote with ZK proof
   */
  vote: ({dao_id, proposal_id, vote_choice, nullifier, root, commitment, proof}: {dao_id: u64, proposal_id: u64, vote_choice: boolean, nullifier: u256, root: u256, commitment: u256, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_vk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set verification key for a DAO (admin only)
   */
  set_vk: ({dao_id, vk, admin}: {dao_id: u64, vk: VerificationKey, admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Contract version for upgrade tracking.
   */
  version: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a vk_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get current VK version for a DAO
   */
  vk_version: ({dao_id}: {dao_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_results transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get results for a proposal (yes_votes, no_votes)
   */
  get_results: ({dao_id, proposal_id}: {dao_id: u64, proposal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, u64]>>

  /**
   * Construct and simulate a get_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get proposal info
   */
  get_proposal: ({dao_id, proposal_id}: {dao_id: u64, proposal_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<ProposalInfo>>

  /**
   * Construct and simulate a tree_contract transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get tree contract address
   */
  tree_contract: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a close_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Close a proposal explicitly (idempotent). End time still enforced in vote.
   */
  close_proposal: ({dao_id, proposal_id, admin}: {dao_id: u64, proposal_id: u64, admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a proposal_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get proposal count for a DAO
   */
  proposal_count: ({dao_id}: {dao_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a vk_for_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get a specific VK version for observability/off-chain verification
   */
  vk_for_version: ({dao_id, version}: {dao_id: u64, version: u32}, options?: MethodOptions) => Promise<AssembledTransaction<VerificationKey>>

  /**
   * Construct and simulate a create_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new proposal for a DAO
   * Voting starts immediately upon creation (Merkle root snapshot taken now)
   * end_time: Unix timestamp for when voting closes (must be in the future)
   */
  create_proposal: ({dao_id, description, end_time, creator, vote_mode}: {dao_id: u64, description: string, end_time: u64, creator: string, vote_mode: VoteMode}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a archive_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Archive a proposal (idempotent). Prevents further votes and signals off-chain cleanup.
   */
  archive_proposal: ({dao_id, proposal_id, admin}: {dao_id: u64, proposal_id: u64, admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if nullifier has been used
   */
  is_nullifier_used: ({dao_id, proposal_id, nullifier}: {dao_id: u64, proposal_id: u64, nullifier: u256}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a set_vk_from_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set verification key from registry during DAO initialization
   * This function is called by the registry contract during create_and_init_dao
   * to avoid re-entrancy issues. The registry is a trusted system contract.
   */
  set_vk_from_registry: ({dao_id, vk}: {dao_id: u64, vk: VerificationKey}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_proposal_with_vk_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create proposal with a specific VK version (must be <= current and exist)
   */
  create_proposal_with_vk_version: ({dao_id, description, end_time, creator, vote_mode, vk_version}: {dao_id: u64, description: string, end_time: u64, creator: string, vote_mode: VoteMode, vk_version: u32}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

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
      new ContractSpec([ "AAAAAAAAABtTdWJtaXQgYSB2b3RlIHdpdGggWksgcHJvb2YAAAAABHZvdGUAAAAHAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAAC3ZvdGVfY2hvaWNlAAAAAAEAAAAAAAAACW51bGxpZmllcgAAAAAAAAwAAAAAAAAABHJvb3QAAAAMAAAAAAAAAApjb21taXRtZW50AAAAAAAMAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAFUHJvb2YAAAAAAAAA",
        "AAAAAQAAAA1Hcm90aDE2IFByb29mAAAAAAAAAAAAAAVQcm9vZgAAAAAAAAMAAAAAAAAAAWEAAAAAAAPuAAAAQAAAAAAAAAABYgAAAAAAA+4AAACAAAAAAAAAAAFjAAAAAAAD7gAAAEA=",
        "AAAAAAAAACtTZXQgdmVyaWZpY2F0aW9uIGtleSBmb3IgYSBEQU8gKGFkbWluIG9ubHkpAAAAAAZzZXRfdmsAAAAAAAMAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAACdmsAAAAAB9AAAAAPVmVyaWZpY2F0aW9uS2V5AAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAEAAAAAAAAACFByb3Bvc2FsAAAAAgAAAAYAAAAGAAAAAQAAAAAAAAANUHJvcG9zYWxDb3VudAAAAAAAAAEAAAAGAAAAAQAAAAAAAAAJTnVsbGlmaWVyAAAAAAAAAwAAAAYAAAAGAAAADAAAAAEAAAAAAAAACVZvdGluZ0tleQAAAAAAAAEAAAAGAAAAAQAAAAAAAAAJVmtWZXJzaW9uAAAAAAAAAQAAAAYAAAABAAAAAAAAAAtWa0J5VmVyc2lvbgAAAAACAAAABgAAAAQAAAAAAAAAAAAAAA5WZXJpZnlPdmVycmlkZQAA",
        "AAAAAAAAACZDb250cmFjdCB2ZXJzaW9uIGZvciB1cGdyYWRlIHRyYWNraW5nLgAAAAAAB3ZlcnNpb24AAAAAAAAAAAEAAAAE",
        "AAAAAgAAAAAAAAAAAAAACFZvdGVNb2RlAAAAAgAAAAAAAAAAAAAABUZpeGVkAAAAAAAAAAAAAAAAAAAIVHJhaWxpbmc=",
        "AAAABQAAAAAAAAAAAAAACVZvdGVFdmVudAAAAAAAAAEAAAAKdm90ZV9ldmVudAAAAAAABAAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAAAAAABmNob2ljZQAAAAAAAQAAAAAAAAAAAAAACW51bGxpZmllcgAAAAAAAAwAAAAAAAAAAg==",
        "AAAAAAAAACBHZXQgY3VycmVudCBWSyB2ZXJzaW9uIGZvciBhIERBTwAAAAp2a192ZXJzaW9uAAAAAAABAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAABA==",
        "AAAABQAAAAAAAAAAAAAAClZLU2V0RXZlbnQAAAAAAAEAAAAMdmtfc2V0X2V2ZW50AAAAAQAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAQAAAAI=",
        "AAAABAAAAAAAAAAAAAAAC1ZvdGluZ0Vycm9yAAAAABQAAAAAAAAACE5vdEFkbWluAAAAAQAAAAAAAAAMVW5hdXRob3JpemVkAAAAEwAAAAAAAAASVmtJY0xlbmd0aE1pc21hdGNoAAAAAAACAAAAAAAAAAxWa0ljVG9vTGFyZ2UAAAADAAAAAAAAABJEZXNjcmlwdGlvblRvb0xvbmcAAAAAAAQAAAAAAAAADE5vdERhb01lbWJlcgAAAAUAAAAAAAAADkVuZFRpbWVJbnZhbGlkAAAAAAAGAAAAAAAAAA1OdWxsaWZpZXJVc2VkAAAAAAAABwAAAAAAAAAMVm90aW5nQ2xvc2VkAAAACAAAAAAAAAAbQ29tbWl0bWVudFJldm9rZWRBdENyZWF0aW9uAAAAAAkAAAAAAAAAHUNvbW1pdG1lbnRSZXZva2VkRHVyaW5nVm90aW5nAAAAAAAACgAAAAAAAAAMUm9vdE1pc21hdGNoAAAACwAAAAAAAAAQUm9vdE5vdEluSGlzdG9yeQAAAAwAAAAAAAAAFFJvb3RQcmVkYXRlc1Byb3Bvc2FsAAAADQAAAAAAAAAJVmtDaGFuZ2VkAAAAAAAADgAAAAAAAAAMSW52YWxpZFByb29mAAAADwAAAAAAAAAIVmtOb3RTZXQAAAAQAAAAAAAAABFWa1ZlcnNpb25NaXNtYXRjaAAAAAAAABEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAEgAAAAAAAAAMSW52YWxpZFN0YXRlAAAAFA==",
        "AAAAAAAAADBHZXQgcmVzdWx0cyBmb3IgYSBwcm9wb3NhbCAoeWVzX3ZvdGVzLCBub192b3RlcykAAAALZ2V0X3Jlc3VsdHMAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAA+0AAAACAAAABgAAAAY=",
        "AAAAAQAAAAAAAAAAAAAADFByb3Bvc2FsSW5mbwAAAA4AAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAACmNyZWF0ZWRfYnkAAAAAABMAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAATZWFybGllc3Rfcm9vdF9pbmRleAAAAAAEAAAAAAAAAA1lbGlnaWJsZV9yb290AAAAAAAADAAAAAAAAAAIZW5kX3RpbWUAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAIbm9fdm90ZXMAAAAGAAAAAAAAAAVzdGF0ZQAAAAAAB9AAAAANUHJvcG9zYWxTdGF0ZQAAAAAAAAAAAAAHdmtfaGFzaAAAAAPuAAAAIAAAAAAAAAAKdmtfdmVyc2lvbgAAAAAABAAAAAAAAAAJdm90ZV9tb2RlAAAAAAAH0AAAAAhWb3RlTW9kZQAAAAAAAAAJeWVzX3ZvdGVzAAAAAAAABg==",
        "AAAAAAAAABFHZXQgcHJvcG9zYWwgaW5mbwAAAAAAAAxnZXRfcHJvcG9zYWwAAAACAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAH0AAAAAxQcm9wb3NhbEluZm8=",
        "AAAAAgAAAAAAAAAAAAAADVByb3Bvc2FsU3RhdGUAAAAAAAADAAAAAAAAAAAAAAAGQWN0aXZlAAAAAAAAAAAAAAAAAAZDbG9zZWQAAAAAAAAAAAAAAAAACEFyY2hpdmVk",
        "AAAAAAAAADxDb25zdHJ1Y3RvcjogSW5pdGlhbGl6ZSBjb250cmFjdCB3aXRoIE1lbWJlcnNoaXBUcmVlIGFkZHJlc3MAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAADXRyZWVfY29udHJhY3QAAAAAAAATAAAAAA==",
        "AAAAAAAAABlHZXQgdHJlZSBjb250cmFjdCBhZGRyZXNzAAAAAAAADXRyZWVfY29udHJhY3QAAAAAAAAAAAAAAQAAABM=",
        "AAAABQAAAAAAAAAAAAAADVByb3Bvc2FsRXZlbnQAAAAAAAABAAAADnByb3Bvc2FsX2V2ZW50AAAAAAAEAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAAAAAAAALZGVzY3JpcHRpb24AAAAAEAAAAAAAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAC",
        "AAAAAAAAAEpDbG9zZSBhIHByb3Bvc2FsIGV4cGxpY2l0bHkgKGlkZW1wb3RlbnQpLiBFbmQgdGltZSBzdGlsbCBlbmZvcmNlZCBpbiB2b3RlLgAAAAAADmNsb3NlX3Byb3Bvc2FsAAAAAAADAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAABxHZXQgcHJvcG9zYWwgY291bnQgZm9yIGEgREFPAAAADnByb3Bvc2FsX2NvdW50AAAAAAABAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAABg==",
        "AAAAAAAAAEJHZXQgYSBzcGVjaWZpYyBWSyB2ZXJzaW9uIGZvciBvYnNlcnZhYmlsaXR5L29mZi1jaGFpbiB2ZXJpZmljYXRpb24AAAAAAA52a19mb3JfdmVyc2lvbgAAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAd2ZXJzaW9uAAAAAAQAAAABAAAH0AAAAA9WZXJpZmljYXRpb25LZXkA",
        "AAAAAQAAACJHcm90aDE2IFZlcmlmaWNhdGlvbiBLZXkgZm9yIEJOMjU0AAAAAAAAAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAFAAAAAAAAAAVhbHBoYQAAAAAAA+4AAABAAAAAAAAAAARiZXRhAAAD7gAAAIAAAAAAAAAABWRlbHRhAAAAAAAD7gAAAIAAAAAAAAAABWdhbW1hAAAAAAAD7gAAAIAAAAAAAAAAAmljAAAAAAPqAAAD7gAAAEA=",
        "AAAAAAAAALBDcmVhdGUgYSBuZXcgcHJvcG9zYWwgZm9yIGEgREFPClZvdGluZyBzdGFydHMgaW1tZWRpYXRlbHkgdXBvbiBjcmVhdGlvbiAoTWVya2xlIHJvb3Qgc25hcHNob3QgdGFrZW4gbm93KQplbmRfdGltZTogVW5peCB0aW1lc3RhbXAgZm9yIHdoZW4gdm90aW5nIGNsb3NlcyAobXVzdCBiZSBpbiB0aGUgZnV0dXJlKQAAAA9jcmVhdGVfcHJvcG9zYWwAAAAABQAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAhlbmRfdGltZQAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAJdm90ZV9tb2RlAAAAAAAH0AAAAAhWb3RlTW9kZQAAAAEAAAAG",
        "AAAAAAAAAFZBcmNoaXZlIGEgcHJvcG9zYWwgKGlkZW1wb3RlbnQpLiBQcmV2ZW50cyBmdXJ0aGVyIHZvdGVzIGFuZCBzaWduYWxzIG9mZi1jaGFpbiBjbGVhbnVwLgAAAAAAEGFyY2hpdmVfcHJvcG9zYWwAAAADAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAABQAAAAAAAAAAAAAAEENvbnRyYWN0VXBncmFkZWQAAAABAAAAEWNvbnRyYWN0X3VwZ3JhZGVkAAAAAAAAAgAAAAAAAAAEZnJvbQAAAAQAAAAAAAAAAAAAAAJ0bwAAAAAABAAAAAAAAAAC",
        "AAAAAAAAACBDaGVjayBpZiBudWxsaWZpZXIgaGFzIGJlZW4gdXNlZAAAABFpc19udWxsaWZpZXJfdXNlZAAAAAAAAAMAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAAAAAAJbnVsbGlmaWVyAAAAAAAADAAAAAEAAAAB",
        "AAAABQAAAAAAAAAAAAAAE1Byb3Bvc2FsQ2xvc2VkRXZlbnQAAAAAAQAAABVwcm9wb3NhbF9jbG9zZWRfZXZlbnQAAAAAAAADAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAAAAAAAAJY2xvc2VkX2J5AAAAAAAAEwAAAAAAAAAC",
        "AAAAAAAAANBTZXQgdmVyaWZpY2F0aW9uIGtleSBmcm9tIHJlZ2lzdHJ5IGR1cmluZyBEQU8gaW5pdGlhbGl6YXRpb24KVGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgYnkgdGhlIHJlZ2lzdHJ5IGNvbnRyYWN0IGR1cmluZyBjcmVhdGVfYW5kX2luaXRfZGFvCnRvIGF2b2lkIHJlLWVudHJhbmN5IGlzc3Vlcy4gVGhlIHJlZ2lzdHJ5IGlzIGEgdHJ1c3RlZCBzeXN0ZW0gY29udHJhY3QuAAAAFHNldF92a19mcm9tX3JlZ2lzdHJ5AAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAJ2awAAAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAA==",
        "AAAABQAAAAAAAAAAAAAAFVByb3Bvc2FsQXJjaGl2ZWRFdmVudAAAAAAAAAEAAAAXcHJvcG9zYWxfYXJjaGl2ZWRfZXZlbnQAAAAAAwAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAAAAAAC2FyY2hpdmVkX2J5AAAAABMAAAAAAAAAAg==",
        "AAAAAAAAAElDcmVhdGUgcHJvcG9zYWwgd2l0aCBhIHNwZWNpZmljIFZLIHZlcnNpb24gKG11c3QgYmUgPD0gY3VycmVudCBhbmQgZXhpc3QpAAAAAAAAH2NyZWF0ZV9wcm9wb3NhbF93aXRoX3ZrX3ZlcnNpb24AAAAABgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAhlbmRfdGltZQAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAJdm90ZV9tb2RlAAAAAAAH0AAAAAhWb3RlTW9kZQAAAAAAAAAKdmtfdmVyc2lvbgAAAAAABAAAAAEAAAAG" ]),
      options
    )
  }
  public readonly fromJSON = {
    vote: this.txFromJSON<null>,
        set_vk: this.txFromJSON<null>,
        version: this.txFromJSON<u32>,
        vk_version: this.txFromJSON<u32>,
        get_results: this.txFromJSON<readonly [u64, u64]>,
        get_proposal: this.txFromJSON<ProposalInfo>,
        tree_contract: this.txFromJSON<string>,
        close_proposal: this.txFromJSON<null>,
        proposal_count: this.txFromJSON<u64>,
        vk_for_version: this.txFromJSON<VerificationKey>,
        create_proposal: this.txFromJSON<u64>,
        archive_proposal: this.txFromJSON<null>,
        is_nullifier_used: this.txFromJSON<boolean>,
        set_vk_from_registry: this.txFromJSON<null>,
        create_proposal_with_vk_version: this.txFromJSON<u64>
  }
}