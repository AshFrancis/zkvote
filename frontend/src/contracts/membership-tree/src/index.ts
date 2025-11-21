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




export type DataKey = {tag: "TreeDepth", values: readonly [u64]} | {tag: "NextLeafIndex", values: readonly [u64]} | {tag: "FilledSubtrees", values: readonly [u64]} | {tag: "Roots", values: readonly [u64]} | {tag: "LeafIndex", values: readonly [u64, u256]};



export interface Client {
  /**
   * Construct and simulate a init_tree transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize a tree for a specific DAO
   * Only DAO admin can initialize (via SBT contract which checks registry)
   */
  init_tree: ({dao_id, depth, admin}: {dao_id: u64, depth: u32, admin: string}, options?: {
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
   * Construct and simulate a init_tree_from_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize tree from registry during DAO initialization
   * This function is called by the registry contract during create_and_init_dao
   * to avoid re-entrancy issues. The registry is a trusted system contract.
   */
  init_tree_from_registry: ({dao_id, depth}: {dao_id: u64, depth: u32}, options?: {
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
   * Construct and simulate a register_from_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a commitment from registry during DAO initialization
   * This function is called by the registry contract during create_and_init_dao
   * to automatically register the creator's commitment.
   * The registry is trusted to have already verified SBT ownership.
   */
  register_from_registry: ({dao_id, commitment}: {dao_id: u64, commitment: u256}, options?: {
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
   * Construct and simulate a register_with_caller transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a commitment with explicit caller (requires SBT membership)
   */
  register_with_caller: ({dao_id, commitment, caller}: {dao_id: u64, commitment: u256, caller: string}, options?: {
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
   * Construct and simulate a current_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get current root for a DAO
   */
  current_root: ({dao_id}: {dao_id: u64}, options?: {
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
  }) => Promise<AssembledTransaction<u256>>

  /**
   * Construct and simulate a get_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get current root (short alias for cross-contract calls)
   */
  get_root: ({dao_id}: {dao_id: u64}, options?: {
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
  }) => Promise<AssembledTransaction<u256>>

  /**
   * Construct and simulate a root_ok transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if a root is valid (in history)
   */
  root_ok: ({dao_id, root}: {dao_id: u64, root: u256}, options?: {
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
   * Construct and simulate a get_leaf_index transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get leaf index for a commitment
   */
  get_leaf_index: ({dao_id, commitment}: {dao_id: u64, commitment: u256}, options?: {
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
  }) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_tree_info transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get tree info for a DAO
   */
  get_tree_info: ({dao_id}: {dao_id: u64}, options?: {
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
  }) => Promise<AssembledTransaction<readonly [u32, u32, u256]>>

  /**
   * Construct and simulate a sbt_contr transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get SBT contract address
   */
  sbt_contr: (options?: {
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
   * Construct and simulate a init_zeros_cache transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pre-initialize the zeros cache to avoid budget issues during first tree operations.
   * This should be called once during deployment to precompute zero values for all levels.
   */
  init_zeros_cache: (options?: {
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

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {sbt_contract}: {sbt_contract: string},
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
    return ContractClient.deploy({sbt_contract}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAEAAAAAAAAACVRyZWVEZXB0aAAAAAAAAAEAAAAGAAAAAQAAAAAAAAANTmV4dExlYWZJbmRleAAAAAAAAAEAAAAGAAAAAQAAAAAAAAAORmlsbGVkU3VidHJlZXMAAAAAAAEAAAAGAAAAAQAAAAAAAAAFUm9vdHMAAAAAAAABAAAABgAAAAEAAAAAAAAACUxlYWZJbmRleAAAAAAAAAIAAAAGAAAADA==",
        "AAAABQAAAAAAAAAAAAAADVRyZWVJbml0RXZlbnQAAAAAAAABAAAAD3RyZWVfaW5pdF9ldmVudAAAAAADAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAVkZXB0aAAAAAAAAAQAAAAAAAAAAAAAAAplbXB0eV9yb290AAAAAAAMAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAC0NvbW1pdEV2ZW50AAAAAAEAAAAMY29tbWl0X2V2ZW50AAAABAAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAQAAAAAAAAAKY29tbWl0bWVudAAAAAAADAAAAAAAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAAAAAACG5ld19yb290AAAADAAAAAAAAAAC",
        "AAAAAAAAADpDb25zdHJ1Y3RvcjogSW5pdGlhbGl6ZSBjb250cmFjdCB3aXRoIFNCVCBjb250cmFjdCBhZGRyZXNzAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAADHNidF9jb250cmFjdAAAABMAAAAA",
        "AAAAAAAAAGtJbml0aWFsaXplIGEgdHJlZSBmb3IgYSBzcGVjaWZpYyBEQU8KT25seSBEQU8gYWRtaW4gY2FuIGluaXRpYWxpemUgKHZpYSBTQlQgY29udHJhY3Qgd2hpY2ggY2hlY2tzIHJlZ2lzdHJ5KQAAAAAJaW5pdF90cmVlAAAAAAAAAwAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAVkZXB0aAAAAAAAAAQAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAMtJbml0aWFsaXplIHRyZWUgZnJvbSByZWdpc3RyeSBkdXJpbmcgREFPIGluaXRpYWxpemF0aW9uClRoaXMgZnVuY3Rpb24gaXMgY2FsbGVkIGJ5IHRoZSByZWdpc3RyeSBjb250cmFjdCBkdXJpbmcgY3JlYXRlX2FuZF9pbml0X2Rhbwp0byBhdm9pZCByZS1lbnRyYW5jeSBpc3N1ZXMuIFRoZSByZWdpc3RyeSBpcyBhIHRydXN0ZWQgc3lzdGVtIGNvbnRyYWN0LgAAAAAXaW5pdF90cmVlX2Zyb21fcmVnaXN0cnkAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAVkZXB0aAAAAAAAAAQAAAAA",
        "AAAAAAAAAP1SZWdpc3RlciBhIGNvbW1pdG1lbnQgZnJvbSByZWdpc3RyeSBkdXJpbmcgREFPIGluaXRpYWxpemF0aW9uClRoaXMgZnVuY3Rpb24gaXMgY2FsbGVkIGJ5IHRoZSByZWdpc3RyeSBjb250cmFjdCBkdXJpbmcgY3JlYXRlX2FuZF9pbml0X2Rhbwp0byBhdXRvbWF0aWNhbGx5IHJlZ2lzdGVyIHRoZSBjcmVhdG9yJ3MgY29tbWl0bWVudC4KVGhlIHJlZ2lzdHJ5IGlzIHRydXN0ZWQgdG8gaGF2ZSBhbHJlYWR5IHZlcmlmaWVkIFNCVCBvd25lcnNoaXAuAAAAAAAAFnJlZ2lzdGVyX2Zyb21fcmVnaXN0cnkAAAAAAAIAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAAKY29tbWl0bWVudAAAAAAADAAAAAA=",
        "AAAAAAAAAERSZWdpc3RlciBhIGNvbW1pdG1lbnQgd2l0aCBleHBsaWNpdCBjYWxsZXIgKHJlcXVpcmVzIFNCVCBtZW1iZXJzaGlwKQAAABRyZWdpc3Rlcl93aXRoX2NhbGxlcgAAAAMAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAAKY29tbWl0bWVudAAAAAAADAAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAABpHZXQgY3VycmVudCByb290IGZvciBhIERBTwAAAAAADGN1cnJlbnRfcm9vdAAAAAEAAAAAAAAABmRhb19pZAAAAAAABgAAAAEAAAAM",
        "AAAAAAAAADdHZXQgY3VycmVudCByb290IChzaG9ydCBhbGlhcyBmb3IgY3Jvc3MtY29udHJhY3QgY2FsbHMpAAAAAAhnZXRfcm9vdAAAAAEAAAAAAAAABmRhb19pZAAAAAAABgAAAAEAAAAM",
        "AAAAAAAAACVDaGVjayBpZiBhIHJvb3QgaXMgdmFsaWQgKGluIGhpc3RvcnkpAAAAAAAAB3Jvb3Rfb2sAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAARyb290AAAADAAAAAEAAAAB",
        "AAAAAAAAAB9HZXQgbGVhZiBpbmRleCBmb3IgYSBjb21taXRtZW50AAAAAA5nZXRfbGVhZl9pbmRleAAAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAApjb21taXRtZW50AAAAAAAMAAAAAQAAAAQ=",
        "AAAAAAAAABdHZXQgdHJlZSBpbmZvIGZvciBhIERBTwAAAAANZ2V0X3RyZWVfaW5mbwAAAAAAAAEAAAAAAAAABmRhb19pZAAAAAAABgAAAAEAAAPtAAAAAwAAAAQAAAAEAAAADA==",
        "AAAAAAAAABhHZXQgU0JUIGNvbnRyYWN0IGFkZHJlc3MAAAAJc2J0X2NvbnRyAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAKpQcmUtaW5pdGlhbGl6ZSB0aGUgemVyb3MgY2FjaGUgdG8gYXZvaWQgYnVkZ2V0IGlzc3VlcyBkdXJpbmcgZmlyc3QgdHJlZSBvcGVyYXRpb25zLgpUaGlzIHNob3VsZCBiZSBjYWxsZWQgb25jZSBkdXJpbmcgZGVwbG95bWVudCB0byBwcmVjb21wdXRlIHplcm8gdmFsdWVzIGZvciBhbGwgbGV2ZWxzLgAAAAAAEGluaXRfemVyb3NfY2FjaGUAAAAAAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    init_tree: this.txFromJSON<null>,
        init_tree_from_registry: this.txFromJSON<null>,
        register_from_registry: this.txFromJSON<null>,
        register_with_caller: this.txFromJSON<null>,
        current_root: this.txFromJSON<u256>,
        get_root: this.txFromJSON<u256>,
        root_ok: this.txFromJSON<boolean>,
        get_leaf_index: this.txFromJSON<u32>,
        get_tree_info: this.txFromJSON<readonly [u32, u32, u256]>,
        sbt_contr: this.txFromJSON<string>,
        init_zeros_cache: this.txFromJSON<null>
  }
}