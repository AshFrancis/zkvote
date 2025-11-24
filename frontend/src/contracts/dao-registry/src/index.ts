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
    contractId: "CBUOISGNHQQFXFJJLYMQDEMEBPFKXWRXDFQGJTYNEYRG6N4MBUVY6O3C",
  }
} as const


export interface DaoInfo {
  admin: string;
  created_at: u64;
  id: u64;
  membership_open: boolean;
  name: string;
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



export interface Client {
  /**
   * Construct and simulate a create_dao transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new DAO (permissionless).
   * Creator automatically becomes the admin.
   * Cannot create DAOs for other people - you can only create your own DAO.
   */
  create_dao: ({name, creator, membership_open}: {name: string, creator: string, membership_open: boolean}, options?: {
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
   * Construct and simulate a get_dao transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get DAO info
   */
  get_dao: ({dao_id}: {dao_id: u64}, options?: {
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
  }) => Promise<AssembledTransaction<DaoInfo>>

  /**
   * Construct and simulate a dao_exists transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if DAO exists
   */
  dao_exists: ({dao_id}: {dao_id: u64}, options?: {
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
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get admin of a DAO
   */
  get_admin: ({dao_id}: {dao_id: u64}, options?: {
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
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer admin rights (current admin only)
   */
  transfer_admin: ({dao_id, new_admin}: {dao_id: u64, new_admin: string}, options?: {
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
   * Construct and simulate a dao_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get total number of DAOs created
   */
  dao_count: (options?: {
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
   * Construct and simulate a is_membership_open transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if a DAO has open membership
   */
  is_membership_open: ({dao_id}: {dao_id: u64}, options?: {
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
   * Construct and simulate a create_and_init_dao_no_reg transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create and initialize DAO without registering creator for voting.
   * Creator must register separately using deterministic credentials.
   * This calls:
   * 1. create_dao (creates registry entry)
   * 2. membership_sbt.mint (mints SBT to creator)
   * 3. membership_tree.init_tree (initializes Merkle tree)
   * 4. voting.set_vk (sets verification key)
   */
  create_and_init_dao_no_reg: ({name, creator, membership_open, sbt_contract, tree_contract, voting_contract, tree_depth, vk}: {name: string, creator: string, membership_open: boolean, sbt_contract: string, tree_contract: string, voting_contract: string, tree_depth: u32, vk: VerificationKey}, options?: {
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
   * Construct and simulate a create_and_init_dao transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create and fully initialize a DAO in a single transaction.
   * This calls:
   * 1. create_dao (creates registry entry)
   * 2. membership_sbt.mint (mints SBT to creator)
   * 3. membership_tree.init_tree (initializes Merkle tree)
   * 4. membership_tree.register_from_registry (registers creator's commitment)
   * 5. voting.set_vk (sets verification key)
   */
  create_and_init_dao: ({name, creator, membership_open, sbt_contract, tree_contract, voting_contract, tree_depth, creator_commitment, vk}: {name: string, creator: string, membership_open: boolean, sbt_contract: string, tree_contract: string, voting_contract: string, tree_depth: u32, creator_commitment: u256, vk: VerificationKey}, options?: {
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
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAAB0Rhb0luZm8AAAAABQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAPbWVtYmVyc2hpcF9vcGVuAAAAAAEAAAAAAAAABG5hbWUAAAAQ",
        "AAAAAQAAACJHcm90aDE2IFZlcmlmaWNhdGlvbiBLZXkgZm9yIEJOMjU0AAAAAAAAAAAAD1ZlcmlmaWNhdGlvbktleQAAAAAFAAAAAAAAAAVhbHBoYQAAAAAAA+4AAABAAAAAAAAAAARiZXRhAAAD7gAAAIAAAAAAAAAABWRlbHRhAAAAAAAD7gAAAIAAAAAAAAAABWdhbW1hAAAAAAAD7gAAAIAAAAAAAAAAAmljAAAAAAPqAAAD7gAAAEA=",
        "AAAABQAAAAAAAAAAAAAADkRhb0NyZWF0ZUV2ZW50AAAAAAABAAAAEGRhb19jcmVhdGVfZXZlbnQAAAADAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADkFkbWluWGZlckV2ZW50AAAAAAABAAAAEGFkbWluX3hmZXJfZXZlbnQAAAADAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAlvbGRfYWRtaW4AAAAAAAATAAAAAAAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAAAAAAC",
        "AAAAAAAAAJNDcmVhdGUgYSBuZXcgREFPIChwZXJtaXNzaW9ubGVzcykuCkNyZWF0b3IgYXV0b21hdGljYWxseSBiZWNvbWVzIHRoZSBhZG1pbi4KQ2Fubm90IGNyZWF0ZSBEQU9zIGZvciBvdGhlciBwZW9wbGUgLSB5b3UgY2FuIG9ubHkgY3JlYXRlIHlvdXIgb3duIERBTy4AAAAACmNyZWF0ZV9kYW8AAAAAAAMAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAAD21lbWJlcnNoaXBfb3BlbgAAAAABAAAAAQAAAAY=",
        "AAAAAAAAAAxHZXQgREFPIGluZm8AAAAHZ2V0X2RhbwAAAAABAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAH0AAAAAdEYW9JbmZvAA==",
        "AAAAAAAAABNDaGVjayBpZiBEQU8gZXhpc3RzAAAAAApkYW9fZXhpc3RzAAAAAAABAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAQ==",
        "AAAAAAAAABJHZXQgYWRtaW4gb2YgYSBEQU8AAAAAAAlnZXRfYWRtaW4AAAAAAAABAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAEw==",
        "AAAAAAAAACpUcmFuc2ZlciBhZG1pbiByaWdodHMgKGN1cnJlbnQgYWRtaW4gb25seSkAAAAAAA50cmFuc2Zlcl9hZG1pbgAAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAACBHZXQgdG90YWwgbnVtYmVyIG9mIERBT3MgY3JlYXRlZAAAAAlkYW9fY291bnQAAAAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAACJDaGVjayBpZiBhIERBTyBoYXMgb3BlbiBtZW1iZXJzaGlwAAAAAAASaXNfbWVtYmVyc2hpcF9vcGVuAAAAAAABAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAQ==",
        "AAAAAAAAAURDcmVhdGUgYW5kIGluaXRpYWxpemUgREFPIHdpdGhvdXQgcmVnaXN0ZXJpbmcgY3JlYXRvciBmb3Igdm90aW5nLgpDcmVhdG9yIG11c3QgcmVnaXN0ZXIgc2VwYXJhdGVseSB1c2luZyBkZXRlcm1pbmlzdGljIGNyZWRlbnRpYWxzLgpUaGlzIGNhbGxzOgoxLiBjcmVhdGVfZGFvIChjcmVhdGVzIHJlZ2lzdHJ5IGVudHJ5KQoyLiBtZW1iZXJzaGlwX3NidC5taW50IChtaW50cyBTQlQgdG8gY3JlYXRvcikKMy4gbWVtYmVyc2hpcF90cmVlLmluaXRfdHJlZSAoaW5pdGlhbGl6ZXMgTWVya2xlIHRyZWUpCjQuIHZvdGluZy5zZXRfdmsgKHNldHMgdmVyaWZpY2F0aW9uIGtleSkAAAAaY3JlYXRlX2FuZF9pbml0X2Rhb19ub19yZWcAAAAAAAgAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAAD21lbWJlcnNoaXBfb3BlbgAAAAABAAAAAAAAAAxzYnRfY29udHJhY3QAAAATAAAAAAAAAA10cmVlX2NvbnRyYWN0AAAAAAAAEwAAAAAAAAAPdm90aW5nX2NvbnRyYWN0AAAAABMAAAAAAAAACnRyZWVfZGVwdGgAAAAAAAQAAAAAAAAAAnZrAAAAAAfQAAAAD1ZlcmlmaWNhdGlvbktleQAAAAABAAAABg==",
        "AAAAAAAAAUZDcmVhdGUgYW5kIGZ1bGx5IGluaXRpYWxpemUgYSBEQU8gaW4gYSBzaW5nbGUgdHJhbnNhY3Rpb24uClRoaXMgY2FsbHM6CjEuIGNyZWF0ZV9kYW8gKGNyZWF0ZXMgcmVnaXN0cnkgZW50cnkpCjIuIG1lbWJlcnNoaXBfc2J0Lm1pbnQgKG1pbnRzIFNCVCB0byBjcmVhdG9yKQozLiBtZW1iZXJzaGlwX3RyZWUuaW5pdF90cmVlIChpbml0aWFsaXplcyBNZXJrbGUgdHJlZSkKNC4gbWVtYmVyc2hpcF90cmVlLnJlZ2lzdGVyX2Zyb21fcmVnaXN0cnkgKHJlZ2lzdGVycyBjcmVhdG9yJ3MgY29tbWl0bWVudCkKNS4gdm90aW5nLnNldF92ayAoc2V0cyB2ZXJpZmljYXRpb24ga2V5KQAAAAAAE2NyZWF0ZV9hbmRfaW5pdF9kYW8AAAAACQAAAAAAAAAEbmFtZQAAABAAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAPbWVtYmVyc2hpcF9vcGVuAAAAAAEAAAAAAAAADHNidF9jb250cmFjdAAAABMAAAAAAAAADXRyZWVfY29udHJhY3QAAAAAAAATAAAAAAAAAA92b3RpbmdfY29udHJhY3QAAAAAEwAAAAAAAAAKdHJlZV9kZXB0aAAAAAAABAAAAAAAAAASY3JlYXRvcl9jb21taXRtZW50AAAAAAAMAAAAAAAAAAJ2awAAAAAH0AAAAA9WZXJpZmljYXRpb25LZXkAAAAAAQAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    create_dao: this.txFromJSON<u64>,
        get_dao: this.txFromJSON<DaoInfo>,
        dao_exists: this.txFromJSON<boolean>,
        get_admin: this.txFromJSON<string>,
        transfer_admin: this.txFromJSON<null>,
        dao_count: this.txFromJSON<u64>,
        is_membership_open: this.txFromJSON<boolean>,
        create_and_init_dao_no_reg: this.txFromJSON<u64>,
        create_and_init_dao: this.txFromJSON<u64>
  }
}