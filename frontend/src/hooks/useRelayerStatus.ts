import { useEffect, useState } from "react";
import { CONTRACTS, NETWORK_CONFIG } from "../config/contracts";
import { checkRelayerReady, fetchRelayerConfig } from "../lib/stellar";
import type { RelayerConfig } from "../lib/stellar";

export type RelayerStatus =
  | { state: "missing-url"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; message: string }
  | { state: "mismatch"; message: string; mismatches: string[] };

export function useRelayerStatus() {
  const [status, setStatus] = useState<RelayerStatus | null>(null);
  const [config, setConfig] = useState<RelayerConfig | null>(null);

  useEffect(() => {
    // Hardcode for local development - Vite env not working properly
    const relayerUrl = "http://localhost:3001";
    const authToken = "";

    console.log("[useRelayerStatus] Using relayerUrl:", relayerUrl);

    if (!relayerUrl) {
      setStatus({ state: "missing-url", message: "Relayer URL not configured" });
      return;
    }

    checkRelayerReady(relayerUrl, authToken || undefined)
      .then((res) => {
        if (res.ok) setStatus({ state: "ready", message: "relayer ready" });
        else setStatus({ state: "error", message: res.error || "relayer not ready" });
      })
      .catch((err) =>
        setStatus({ state: "error", message: err?.message || "relayer check failed" })
      );

    fetchRelayerConfig(relayerUrl, authToken || undefined)
      .then((cfg) => setConfig(cfg))
      .catch(() => {
        // keep existing status; errors are handled in ready check
      });
  }, []);

  useEffect(() => {
    if (!config) return;
    const mismatches: string[] = [];
    if (config.votingContract && config.votingContract !== CONTRACTS.VOTING_ID) {
      mismatches.push(
        `Relayer votingContract (${config.votingContract}) differs from local config (${CONTRACTS.VOTING_ID})`
      );
    }
    if (config.treeContract && config.treeContract !== CONTRACTS.TREE_ID) {
      mismatches.push(
        `Relayer treeContract (${config.treeContract}) differs from local config (${CONTRACTS.TREE_ID})`
      );
    }
    if (
      config.networkPassphrase &&
      config.networkPassphrase !== NETWORK_CONFIG.networkPassphrase
    ) {
      mismatches.push(
        `Relayer networkPassphrase differs from local config (${NETWORK_CONFIG.networkPassphrase})`
      );
    }
    if (config.rpc && config.rpc !== NETWORK_CONFIG.rpcUrl) {
      mismatches.push(`Relayer RPC differs from local config (${NETWORK_CONFIG.rpcUrl})`);
    }
    if (mismatches.length) {
      setStatus({ state: "mismatch", message: "relayer config mismatch", mismatches });
    } else if (status?.state === "ready" || status?.state === "error") {
      // leave as-is
    } else {
      setStatus((prev) => prev ?? { state: "ready", message: "relayer ready" });
    }
  }, [config]);

  return { status, relayerConfig: config };
}
