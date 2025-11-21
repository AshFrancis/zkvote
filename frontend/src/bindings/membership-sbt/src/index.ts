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




export type DataKey = {tag: "Member", values: readonly [u64, string]} | {tag: "Alias", values: readonly [u64, string]};


export interface Client {
  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mint SBT to address for a specific DAO
   * Only DAO admin can mint (verified via registry)
   * Optionally stores an encrypted alias for the member
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
   * Check if address has SBT for a specific DAO
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
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAEAAAAAAAAABk1lbWJlcgAAAAAAAgAAAAYAAAATAAAAAQAAAAAAAAAFQWxpYXMAAAAAAAACAAAABgAAABM=",
        "AAAABQAAAAAAAAAAAAAADFNidE1pbnRFdmVudAAAAAEAAAAOc2J0X21pbnRfZXZlbnQAAAAAAAIAAAAAAAAABmRhb19pZAAAAAAABgAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAI=",
        "AAAAAAAAADpDb25zdHJ1Y3RvcjogSW5pdGlhbGl6ZSBjb250cmFjdCB3aXRoIERBTyBSZWdpc3RyeSBhZGRyZXNzAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAA=",
        "AAAAAAAAAIpNaW50IFNCVCB0byBhZGRyZXNzIGZvciBhIHNwZWNpZmljIERBTwpPbmx5IERBTyBhZG1pbiBjYW4gbWludCAodmVyaWZpZWQgdmlhIHJlZ2lzdHJ5KQpPcHRpb25hbGx5IHN0b3JlcyBhbiBlbmNyeXB0ZWQgYWxpYXMgZm9yIHRoZSBtZW1iZXIAAAAAAARtaW50AAAABAAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA9lbmNyeXB0ZWRfYWxpYXMAAAAD6AAAABAAAAAA",
        "AAAAAAAAAMRNaW50IFNCVCBmcm9tIHJlZ2lzdHJ5IGR1cmluZyBEQU8gaW5pdGlhbGl6YXRpb24KVGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgYnkgdGhlIHJlZ2lzdHJ5IGNvbnRyYWN0IGR1cmluZyBjcmVhdGVfYW5kX2luaXRfZGFvCnRvIGF2b2lkIHJlLWVudHJhbmN5IGlzc3Vlcy4gVGhlIHJlZ2lzdHJ5IGlzIGEgdHJ1c3RlZCBzeXN0ZW0gY29udHJhY3QuAAAAEm1pbnRfZnJvbV9yZWdpc3RyeQAAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAJ0bwAAAAAAEwAAAAA=",
        "AAAAAAAAACtDaGVjayBpZiBhZGRyZXNzIGhhcyBTQlQgZm9yIGEgc3BlY2lmaWMgREFPAAAAAANoYXMAAAAAAgAAAAAAAAAGZGFvX2lkAAAAAAAGAAAAAAAAAAJvZgAAAAAAEwAAAAEAAAAB",
        "AAAAAAAAABRHZXQgcmVnaXN0cnkgYWRkcmVzcwAAAAhyZWdpc3RyeQAAAAAAAAABAAAAEw==",
        "AAAAAAAAAClHZXQgZW5jcnlwdGVkIGFsaWFzIGZvciBhIG1lbWJlciAoaWYgc2V0KQAAAAAAAAlnZXRfYWxpYXMAAAAAAAACAAAAAAAAAAZkYW9faWQAAAAAAAYAAAAAAAAABm1lbWJlcgAAAAAAEwAAAAEAAAPoAAAAEA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    mint: this.txFromJSON<null>,
        mint_from_registry: this.txFromJSON<null>,
        has: this.txFromJSON<boolean>,
        registry: this.txFromJSON<string>,
        get_alias: this.txFromJSON<Option<string>>
  }
}