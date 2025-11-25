// Stellar SDK initialization and helper functions

import {
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
} from "@stellar/stellar-sdk";
import { NETWORK_CONFIG } from "../config/contracts";
import axios from "axios";

// Initialize Soroban RPC server
// allowHttp: true is required for local development on http://localhost
export const server = new rpc.Server(NETWORK_CONFIG.rpcUrl, {
  allowHttp: true,
});

// Network passphrase
export const networkPassphrase = NETWORK_CONFIG.networkPassphrase;

// Optional relayer endpoints (if front-end is allowed to call them directly)
export async function checkRelayerReady(relayerUrl: string, authToken?: string) {
  const headers: Record<string, string> = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  try {
    const res = await axios.get(`${relayerUrl}/ready`, { headers });
    return { ok: res.data?.status === "ready", details: res.data };
  } catch (err: any) {
    return { ok: false, error: err?.message || "ready check failed" };
  }
}

/**
 * Build and simulate a contract invocation transaction
 * @param source Source account public key
 * @param contractId Contract address
 * @param method Contract method name
 * @param args Method arguments as XDR values
 * @returns Prepared transaction ready for signing
 */
export async function buildContractInvocation(
  source: string,
  contractId: string,
  method: string,
  ...args: any[]
) {
  let sourceAccount;

  try {
    // Try to get the actual account
    sourceAccount = await server.getAccount(source);
  } catch (e) {
    // If account doesn't exist or can't be fetched, use a mock account for simulation
    // This works for read-only operations
    sourceAccount = new (await import("@stellar/stellar-sdk")).Account(source, "0");
  }

  const contract = new Contract(contractId);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate transaction to get resource fees
  const simulated = await server.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  // Prepare transaction with simulation results
  const prepared = rpc.assembleTransaction(
    transaction,
    simulated
  ).build();

  return prepared;
}

/**
 * Sign and submit a transaction using the wallet kit
 * @param tx Transaction to sign and submit
 * @param kit Stellar Wallets Kit instance
 * @returns Transaction result
 */
export async function signAndSubmitTransaction(
  tx: any,
  kit: any
) {
  // Sign transaction using wallet kit
  const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
    networkPassphrase,
  });

  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);

  const result = await server.sendTransaction(signedTx);

  if (result.status === "ERROR") {
    throw new Error(`Transaction failed: ${result.errorResult}`);
  }

  // Poll for transaction result
  let getResponse = await server.getTransaction(result.hash);

  while (getResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    getResponse = await server.getTransaction(result.hash);
  }

  if (getResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error(`Transaction failed: ${getResponse.resultXdr}`);
  }

  return getResponse;
}

/**
 * Simulate a read-only contract call without needing a funded account
 * @param contractId Contract address
 * @param method Contract method name
 * @param args Method arguments as XDR values
 * @returns Simulation result
 */
export async function simulateContractCall(
  contractId: string,
  method: string,
  ...args: any[]
) {
  const contract = new Contract(contractId);

  // Use a dummy account with sequence 0 for simulation
  const Account = (await import("@stellar/stellar-sdk")).Account;
  const dummyAccount = new Account(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "0"
  );

  const transaction = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  return simulated;
}

/**
 * Convert a Stellar address to a contract Address type
 */
export function addressToScVal(address: string) {
  return Address.fromString(address).toScVal();
}

/**
 * Check if Freighter wallet is installed
 */
export function isFreighterInstalled(): boolean {
  return typeof window !== "undefined" && "freighter" in window;
}
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
