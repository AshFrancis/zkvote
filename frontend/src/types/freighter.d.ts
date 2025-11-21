// Type definitions for Freighter wallet API

declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<boolean>;
      getPublicKey: () => Promise<string>;
      signTransaction: (xdr: string, options?: {
        networkPassphrase?: string;
        address?: string;
      }) => Promise<string>;
      getNetwork: () => Promise<string>;
      getNetworkDetails: () => Promise<{
        network: string;
        networkPassphrase: string;
      }>;
    };
  }
}

export {};
