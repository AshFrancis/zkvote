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




export type DataKey = {tag: "Member", values: readonly [u64, string]} | {tag: "Alias", values: readonly [u64, string]} | {tag: "Revoked", values: readonly [u64, string]} | {tag: "MemberCount", values: readonly [u64]} | {tag: "MemberAtIndex", values: readonly [u64, u64]};




export interface Client {
  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mint SBT to address for a specific DAO
   * Only DAO admin can mint (verified via registry)
   * Optionally stores an encrypted alias for the member
   * Can re-mint to previously revoked members
   */
  mint: ({dao_id, to, admin, encrypted_alias}: {dao_id: u64, to: string, admin: string, encrypted_alias: Option<string>}, options?: {
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
   * Construct and simulate a mint_from_registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mint SBT from registry during DAO initialization
   * This function is called by the registry contract during create_and_init_dao
   * to avoid re-entrancy issues. The registry is a trusted system contract.
   */
  mint_from_registry: ({dao_id, to}: {dao_id: u64, to: string}, options?: {
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
   * Construct and simulate a has transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check if address has SBT for a specific DAO (and is not revoked)
   */
  has: ({dao_id, of}: {dao_id: u64, of: string}, options?: {
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
   * Construct and simulate a registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get registry address
   */
  registry: (options?: {
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
   * Construct and simulate a get_alias transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get encrypted alias for a member (if set)
   */
  get_alias: ({dao_id, member}: {dao_id: u64, member: string}, options?: {
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
  }) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a revoke transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Revoke an SBT (admin only)
   * Sets revocation flag, keeping member entry and alias intact
   */
  revoke: ({dao_id, member, admin}: {dao_id: u64, member: string, admin: string}, options?: {
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
   * Construct and simulate a leave transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Leave DAO voluntarily (member self-revokes)
   * Sets revocation flag, keeping member entry and alias intact
   */
  leave: ({dao_id, member}: {dao_id: u64, member: string}, options?: {
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
   * Construct and simulate a self_join transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Self-join a DAO with open membership
   * Allows users to mint their own SBT if the DAO allows open membership
   */
  self_join: ({dao_id, member, encrypted_alias}: {dao_id: u64, member: string, encrypted_alias: Option<string>}, options?: {
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
   * Construct and simulate a update_alias transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update encrypted alias for a member (admin only)
   */
  update_alias: ({dao_id, member, admin, new_encrypted_alias}: {dao_id: u64, member: string, admin: string, new_encrypted_alias: string}, options?: {
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
   * Construct and simulate a get_member_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get total member count for a DAO
   */
  get_member_count: ({dao_id}: {dao_id: u64}, options?: {
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
   * Construct and simulate a get_member_at_index transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get member address at a specific index
   */
  get_member_at_index: ({dao_id, index}: {dao_id: u64, index: u64}, options?: {
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
  }) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a get_members transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get a batch of members for a DAO
   * Returns addresses from offset to offset+limit (or end of list)
   */
  get_members: ({dao_id, offset, limit}: {dao_id: u64, offset: u64, limit: u64}, options?: {
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
  }) => Promise<AssembledTransaction<Array<string>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {registry}: {registry: string},
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
    return ContractClient.deploy({registry}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAEAAAAAAAAABk1lbWJlcgAAAAAAAgAAAAYAAAATAAAAAQAAAAAAAAAFQWxpYXMAAAAAAAACAAAABgAAABMAAAABAAAAAAAAAAdSZXZva2VkAAAAAAIAAAAGAAAAEwAAAAEAAAAAAAAAC01lbWJlckNvdW50AAAAAAEAAAAGAAAAAQAAAAAAAAANTWVtYmVyQXRJbmRleAAAAAAAAAIAAAAGAAAABg==",
        "AAAABQAAAAAAAAAAAAAADFNidE1pbnRFdmVudAAAAAEAAAAOc2J0X21pbnRfZXZlbnQAAAAAAAIAAAAAAAAABmRhb19pZAAAAAAABgAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlNidFJldm9rZUV2ZW50AAAAAAABAAAAEHNidF9yZXZva2VfZXZlbnQAAAACAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADVNidExlYXZlRXZlbnQAAAAAAAABAAAAD3NidF9sZWF2ZV9ldmVudAAAAAACAAAAAAAAAAZkYW9faWQAAAAAAAYAAAABAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAAAg==",
        "AAAAAAAAADpDb25zdHJ1Y3RvcjogSW5pdGlhbGl6ZSBjb250cmFjdCB3aXRoIERBTyBSZWdpc3RyeSBhZGRyZXNzAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAA=",
        "AAAAAAAAALRNaW50IFNCVCB0byBhZGRyZXNzIGZvciBhIHNwZWNpZmljIERBTwpPbmx5IERBTyBhZG1pbiBjYW4gbWludCAodmVyaWZpZWQgdmlhIHJlZ2lzdHJ5KQpPcHRpb25hbGx5IHN0b3JlcyBhbiBlbmNyeXB0ZWQgYWxpYXMgZm9yIHRoZSBtZW1iZXIKQ2FuIHJlLW1pbnQgdG8gcHJldmlvdXNseSByZXZva2VkIG1lbWJlcnMAAAAEbWludAAAAAQAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAACdG8AAAAAABMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAPZW5jcnlwdGVkX2FsaWFzAAAAA+gAAAAQAAAAAA==",
        "AAAAAAAAAMRNaW50IFNCVCBmcm9tIHJlZ2lzdHJ5IGR1cmluZyBEQU8gaW5pdGlhbGl6YXRpb24KVGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgYnkgdGhlIHJlZ2lzdHJ5IGNvbnRyYWN0IGR1cmluZyBjcmVhdGVfYW5kX2luaXRfZGFvCnRvIGF2b2lkIHJlLWVudHJhbmN5IGlzc3Vlcy4gVGhlIHJlZ2lzdHJ5IGlzIGEgdHJ1c3RlZCBzeXN0ZW0gY29udHJhY3QuAAAAEm1pbnRfZnJvbV9yZWdpc3RyeQAAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAJ0bwAAAAAAEwAAAAA=",
        "AAAAAAAAAEBDaGVjayBpZiBhZGRyZXNzIGhhcyBTQlQgZm9yIGEgc3BlY2lmaWMgREFPIChhbmQgaXMgbm90IHJldm9rZWQpAAAAA2hhcwAAAAACAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAAAm9mAAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAABRHZXQgcmVnaXN0cnkgYWRkcmVzcwAAAAhyZWdpc3RyeQAAAAAAAAABAAAAEw==",
        "AAAAAAAAAClHZXQgZW5jcnlwdGVkIGFsaWFzIGZvciBhIG1lbWJlciAoaWYgc2V0KQAAAAAAAAlnZXRfYWxpYXMAAAAAAAACAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAABm1lbWJlcgAAAAAAEwAAAAEAAAPoAAAAEA==",
        "AAAAAAAAAFZSZXZva2UgYW4gU0JUIChhZG1pbiBvbmx5KQpTZXRzIHJldm9jYXRpb24gZmxhZywga2VlcGluZyBtZW1iZXIgZW50cnkgYW5kIGFsaWFzIGludGFjdAAAAAAABnJldm9rZQAAAAAAAwAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAGdMZWF2ZSBEQU8gdm9sdW50YXJpbHkgKG1lbWJlciBzZWxmLXJldm9rZXMpClNldHMgcmV2b2NhdGlvbiBmbGFnLCBrZWVwaW5nIG1lbWJlciBlbnRyeSBhbmQgYWxpYXMgaW50YWN0AAAAAAVsZWF2ZQAAAAAAAAIAAAAAAAAABmRhb19pZAAAAAAABgAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAA==",
        "AAAAAAAAAGlTZWxmLWpvaW4gYSBEQU8gd2l0aCBvcGVuIG1lbWJlcnNoaXAKQWxsb3dzIHVzZXJzIHRvIG1pbnQgdGhlaXIgb3duIFNCVCBpZiB0aGUgREFPIGFsbG93cyBvcGVuIG1lbWJlcnNoaXAAAAAAAAAJc2VsZl9qb2luAAAAAAAAAwAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAAD2VuY3J5cHRlZF9hbGlhcwAAAAPoAAAAEAAAAAA=",
        "AAAAAAAAADBVcGRhdGUgZW5jcnlwdGVkIGFsaWFzIGZvciBhIG1lbWJlciAoYWRtaW4gb25seSkAAAAMdXBkYXRlX2FsaWFzAAAABAAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAATbmV3X2VuY3J5cHRlZF9hbGlhcwAAAAAQAAAAAA==",
        "AAAAAAAAACBHZXQgdG90YWwgbWVtYmVyIGNvdW50IGZvciBhIERBTwAAABBnZXRfbWVtYmVyX2NvdW50AAAAAQAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAQAAAAY=",
        "AAAAAAAAACZHZXQgbWVtYmVyIGFkZHJlc3MgYXQgYSBzcGVjaWZpYyBpbmRleAAAAAAAE2dldF9tZW1iZXJfYXRfaW5kZXgAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAVpbmRleAAAAAAAAAYAAAABAAAD6AAAABM=",
        "AAAAAAAAAF9HZXQgYSBiYXRjaCBvZiBtZW1iZXJzIGZvciBhIERBTwpSZXR1cm5zIGFkZHJlc3NlcyBmcm9tIG9mZnNldCB0byBvZmZzZXQrbGltaXQgKG9yIGVuZCBvZiBsaXN0KQAAAAALZ2V0X21lbWJlcnMAAAAAAwAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAZvZmZzZXQAAAAAAAYAAAAAAAAABWxpbWl0AAAAAAAABgAAAAEAAAPqAAAAEw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    mint: this.txFromJSON<null>,
        mint_from_registry: this.txFromJSON<null>,
        has: this.txFromJSON<boolean>,
        registry: this.txFromJSON<string>,
        get_alias: this.txFromJSON<Option<string>>,
        revoke: this.txFromJSON<null>,
        leave: this.txFromJSON<null>,
        self_join: this.txFromJSON<null>,
        update_alias: this.txFromJSON<null>,
        get_member_count: this.txFromJSON<u64>,
        get_member_at_index: this.txFromJSON<Option<string>>,
        get_members: this.txFromJSON<Array<string>>
  }
}