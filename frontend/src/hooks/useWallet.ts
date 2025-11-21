import { useState, useCallback, useEffect } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
  xBullModule,
  AlbedoModule,
} from "@creit.tech/stellar-wallets-kit";
import type { ISupportedWallet } from "@creit.tech/stellar-wallets-kit";

export interface WalletState {
  publicKey: string | null;
  isConnected: boolean;
  isInitializing: boolean;
  kit: StellarWalletsKit | null;
}

let globalKit: StellarWalletsKit | null = null;

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    publicKey: null,
    isConnected: false,
    isInitializing: true,
    kit: null,
  });

  useEffect(() => {
    console.log('[useWallet] Initializing wallet...');
    // Initialize kit only once
    if (!globalKit) {
      globalKit = new StellarWalletsKit({
        network: WalletNetwork.FUTURENET,
        selectedWalletId: FREIGHTER_ID,
        modules: [
          new FreighterModule(),
          new xBullModule(),
          new AlbedoModule(),
        ],
      });
    }

    setWallet(prev => ({ ...prev, kit: globalKit }));

    // Only attempt auto-reconnect if user previously connected
    const checkConnection = async () => {
      const storedWalletId = localStorage.getItem("selectedWalletId");
      if (!storedWalletId) {
        // No previous connection, skip auto-reconnect
        console.log('[useWallet] No stored wallet, skipping auto-reconnect. isInitializing -> false');
        setWallet(prev => ({ ...prev, isInitializing: false }));
        return;
      }

      try {
        // User previously connected, attempt silent reconnect
        console.log('[useWallet] Attempting auto-reconnect...');
        globalKit!.setWallet(storedWalletId);
        const { address } = await globalKit!.getAddress();
        if (address) {
          console.log("[useWallet] Auto-reconnected to wallet:", address, "isInitializing -> false");
          setWallet({
            publicKey: address,
            isConnected: true,
            isInitializing: false,
            kit: globalKit,
          });
        }
      } catch (error) {
        // Auto-reconnect failed, clear stored wallet
        console.log("[useWallet] Auto-reconnect failed, user needs to reconnect manually. isInitializing -> false");
        localStorage.removeItem("selectedWalletId");
        setWallet(prev => ({ ...prev, isInitializing: false }));
      }
    };

    checkConnection();
  }, []);

  const connect = useCallback(async () => {
    if (!globalKit) {
      throw new Error("Wallet kit not initialized");
    }

    try {
      await globalKit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          globalKit!.setWallet(option.id);
          const { address } = await globalKit!.getAddress();

          // Store wallet selection in localStorage for persistence
          localStorage.setItem("selectedWalletId", option.id);

          setWallet({
            publicKey: address,
            isConnected: true,
            isInitializing: false,
            kit: globalKit,
          });
        },
      });
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    // Clear stored wallet selection
    localStorage.removeItem("selectedWalletId");

    // Clear all Stellar Wallets Kit localStorage entries
    // The library stores data with keys prefixed with "SWK" or containing "stellar"
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('SWK') ||
          key.toLowerCase().includes('stellar') ||
          key.toLowerCase().includes('wallet') ||
          key.toLowerCase().includes('freighter') ||
          key.toLowerCase().includes('albedo') ||
          key.toLowerCase().includes('xbull')) {
        localStorage.removeItem(key);
      }
    });

    setWallet({ publicKey: null, isConnected: false, isInitializing: false, kit: globalKit });
  }, []);

  return {
    ...wallet,
    connect,
    disconnect,
  };
}
