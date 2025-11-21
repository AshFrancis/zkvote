# Stellar Wallets Kit - Wallet Persistence & UX Analysis

## Overview
The Stellar Wallets Kit is a TypeScript library that provides unified integration for 11+ Stellar blockchain wallets with built-in state management, localStorage persistence, and UI components.

**Repository**: https://github.com/Creit-Tech/Stellar-Wallets-Kit
**Package**: @creit.tech/stellar-wallets-kit
**Current Version**: 1.9.5 (in your frontend)
**License**: MIT

---

## 1. Built-in Persistence & localStorage Features

### State Management Architecture

The kit uses **@ngneat/elf** (a state management library) combined with RxJS for reactive state management. The store automatically handles persistence through its built-in mechanisms.

### localStorage Keys Used

The kit persists the following data:

1. **activeAddress** - Currently connected wallet public key
2. **selectedModuleId** - ID of the selected wallet module
3. **mnemonicPath** - Derivation path for hardware wallets (BIP44 format: `"44'/148'/{index}'`)
4. **hardwareWalletPaths** - Array of hardware wallet public keys and derivation indices
5. **wcSessionPaths** - WalletConnect session mappings (public key to topic)
6. **usedWalletsIds** - Recently used wallet IDs for quick access

### Persistence Implementation

The kit automatically saves wallet state to localStorage through Elf's persistence layer:

```typescript
// State interface that gets persisted
interface StateProps {
  allowedWallets: ISupportedWallet[];
  horizonUrl?: string;
  selectedNetwork?: WalletNetwork;
  selectedModuleId?: string;
  modalTheme?: IModalTheme;
  buttonTheme?: IButtonTheme;
  activeAddress?: string;
  mnemonicPath?: string;
  hardwareWalletPaths: {
    publicKey: string;
    index: number;
  }[];
}
```

---

## 2. API Methods for Persistence & Auto-Reconnect

### Main Kit Class Methods

```typescript
class StellarWalletsKit {
  // Initialization
  constructor(params: StellarWalletsKitParams)
  
  // Wallet Management
  setWallet(id: string): void
  getAddress(params?: {
    path?: string;
    skipRequestAccess?: boolean;
  }): Promise<{ address: string }>
  
  // Disconnection
  disconnect(): Promise<void>
  
  // State Queries
  getSupportedWallets(): Promise<ISupportedWallet[]>
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>
  
  // UI Components
  createButton(params: ButtonParams): Promise<void>
  removeButton(params?: { skipDisconnect?: boolean }): Promise<void>
  openModal(params: ModalParams): Promise<void>
  
  // Custom Button Integration
  assignButtons(params: {
    connectEl: HTMLElement | string;
    disconnectEl?: HTMLElement | string;
    onConnect: (response: { address: string }) => void;
    onDisconnect: () => void;
  }): void
}
```

### Store API Methods

```typescript
// Reactive Observables
export const activeAddress$: Observable<string | undefined>
export const selectedNetwork$: Observable<WalletNetwork | undefined>
export const hardwareWalletPaths$: Observable<HardwareWalletPath[]>
export const mnemonicPath$: Observable<string | undefined>

// Setter Functions
export function setAddress(address: string): void
export function removeAddress(): void
export function setSelectedModuleId(moduleId: string): void
export function setNetwork(network: WalletNetwork): void
export function setHardwareWalletPaths(accounts: HardwareWalletPath[]): void
export function removeMnemonicPath(): void
export function removeHardwareWalletPaths(): void
```

---

## 3. Configuration Options

### Initialization Parameters

```typescript
interface StellarWalletsKitParams {
  selectedWalletId?: string;              // Auto-select wallet on init
  network: WalletNetwork;                 // PUBLIC | TESTNET | FUTURENET | SANDBOX
  modules: ModuleInterface[];             // Wallet modules to support
  modalTheme?: IModalTheme;                // Modal styling
  buttonTheme?: IButtonTheme;              // Button styling
}
```

### Supported Networks

```typescript
enum WalletNetwork {
  PUBLIC = "Public Global Stellar Network ; September 2015",
  TESTNET = "Test SDF Network ; September 2015",
  FUTURENET = "Test SDF Future Network ; October 2022",
  SANDBOX = "Local Sandbox Stellar Network ; September 2022",
  STANDALONE = "Standalone Network ; February 2017"
}
```

### Theme Configuration

**Modal Theme:**
```typescript
interface IModalTheme {
  bgColor: string;
  textColor: string;
  solidTextColor: string;
  headerButtonColor: string;
  dividerColor: string;
  helpBgColor: string;
  notAvailableTextColor: string;
  notAvailableBgColor: string;
  notAvailableBorderColor: string;
}
```

**Button Theme:**
```typescript
interface IButtonTheme {
  bgColor: string;
  textColor: string;
  solidTextColor: string;
  dividerColor: string;
  buttonPadding: string;
  buttonBorderRadius: string;
}
```

---

## 4. Auto-Reconnect Pattern

### How It Works

The kit doesn't explicitly provide an "auto-reconnect" method, but **implicit reconnection** happens through:

1. **localStorage persistence** - Session data (address, module ID) is automatically saved
2. **State initialization** - On page load, the store retrieves saved state from localStorage
3. **Reactive state** - RxJS observables emit the restored state
4. **Application integration** - Your app subscribes to state changes and rebuilds UI

### Implementation Pattern

You need to implement auto-reconnect in your application:

```typescript
import { 
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  activeAddress$
} from '@creit.tech/stellar-wallets-kit';

// 1. Initialize kit with persisted wallet selection
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
});

// 2. Subscribe to address changes
activeAddress$.subscribe(address => {
  if (address) {
    // User is connected - auto-restore UI
    console.log('Connected:', address);
  } else {
    // User is not connected - show connect button
    console.log('Disconnected');
  }
});

// 3. On page load, the kit will:
//    - Load persisted activeAddress from localStorage
//    - Load persisted selectedModuleId
//    - Emit these values through the observables
//    - Your subscription above will trigger automatically
```

---

## 5. Complete Integration Examples

### Example 1: Basic Setup with Auto-Reconnect

```typescript
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  activeAddress$,
  selectedNetwork$
} from '@creit.tech/stellar-wallets-kit';

// Create kit instance
const kit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  modules: allowAllModules(),
});

// Store state in component
let currentAddress: string | undefined = undefined;

// Subscribe to persisted state
const addressSub = activeAddress$.subscribe(address => {
  currentAddress = address;
  
  if (address) {
    // Auto-reconnected! Update UI
    updateConnectedState(address);
  } else {
    // Not connected - show connect button
    showConnectButton();
  }
});

// User clicks connect
async function handleConnect() {
  await kit.openModal({
    onWalletSelected: async (wallet) => {
      kit.setWallet(wallet.id);
      const { address } = await kit.getAddress();
      // Address is automatically persisted by the kit!
    }
  });
}

// Cleanup on unmount
addressSub.unsubscribe();
```

### Example 2: Using the Built-in Button Component

```typescript
import { StellarWalletsKit, WalletNetwork, allowAllModules } from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
});

// Create button with callbacks
await kit.createButton({
  container: document.getElementById('wallet-button'),
  onConnect: ({ address }) => {
    console.log('Connected:', address);
    // Kit automatically persists this address to localStorage
    // On next page load, the connection will be restored
  },
  onDisconnect: () => {
    console.log('Disconnected');
    // Kit automatically clears localStorage
  },
  buttonText: 'Connect Wallet'
});

// The button will automatically restore previous connection on page reload
```

### Example 3: Custom Button Integration

```typescript
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
});

// Use your own buttons instead of kit's built-in button
kit.assignButtons({
  connectEl: '#my-connect-btn',
  disconnectEl: '#my-disconnect-btn',
  onConnect: ({ address }) => {
    // Address is persisted automatically
    document.getElementById('address-display').textContent = address;
  },
  onDisconnect: () => {
    // localStorage is cleared automatically
    document.getElementById('address-display').textContent = 'Not connected';
  }
});
```

### Example 4: Hardware Wallet Path Persistence

```typescript
import { setHardwareWalletPaths, hardwareWalletPaths$ } from '@creit.tech/stellar-wallets-kit';

// Manually set hardware wallet paths (saved to localStorage)
setHardwareWalletPaths([
  { publicKey: 'GC...', index: 0 },
  { publicKey: 'GC...', index: 1 }
]);

// Subscribe to changes
hardwareWalletPaths$.subscribe(paths => {
  console.log('Persisted hardware paths:', paths);
  // This data persists across page reloads
});
```

---

## 6. Supported Wallets

| Wallet | Module Class | Identifier | Type |
|--------|--------------|------------|------|
| xBull Wallet | xBullModule | XBULL_ID | Hot Wallet |
| Albedo | AlbedoModule | ALBEDO_ID | Hot Wallet |
| Freighter | FreighterModule | FREIGHTER_ID | Hot Wallet |
| Rabet | RabetModule | RABET_ID | Hot Wallet |
| WalletConnect | WalletConnectModule | WALLET_CONNECT_ID | Bridge Wallet |
| Lobstr | LobstrModule | LOBSTR_ID | Hot Wallet |
| Hana | HanaModule | HANA_ID | Hot Wallet |
| Hot Wallet | HotWalletModule | HOTWALLET_ID | Hot Wallet |
| Klever Wallet | KleverModule | KLEVER_ID | Hot Wallet |
| Ledger | LedgerModule | LEDGER_ID | Hardware Wallet |
| Trezor | TrezorModule | TREZOR_ID | Hardware Wallet |

---

## 7. Best Practices

### 1. Single Kit Instance
```typescript
// DON'T: Create multiple instances
const kit1 = new StellarWalletsKit({...});
const kit2 = new StellarWalletsKit({...});

// DO: Create once, reuse globally
export const kit = new StellarWalletsKit({...});
import { kit } from './wallet-kit';
```

### 2. Proper Subscription Cleanup
```typescript
// AVOID: Memory leaks
const subscription = activeAddress$.subscribe(...);
// Component unmounts - subscription still active!

// DO: Unsubscribe on cleanup
const subscription = activeAddress$.subscribe(...);
return () => subscription.unsubscribe(); // In useEffect cleanup
```

### 3. Hardware Wallet Configuration
```typescript
// Hardware wallets require explicit path handling
const { address } = await kit.getAddress({
  path: "44'/148'/0'" // BIP44 derivation path
});
```

### 4. WalletConnect Setup
```typescript
import { WalletConnectModule } from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  modules: [
    new WalletConnectModule({
      projectId: 'YOUR_WALLET_CONNECT_PROJECT_ID',
      name: 'Your App Name'
    })
  ]
});

// WalletConnect sessions are persisted in wcSessionPaths
```

### 5. Error Handling
```typescript
try {
  const { address } = await kit.getAddress();
} catch (error) {
  console.error('Failed to get address:', error);
  // User rejected request or wallet not connected
}
```

### 6. Network Validation
```typescript
// Always validate network before signing
const { networkPassphrase } = await kit.getNetwork();

// For transactions requiring specific network:
if (networkPassphrase !== WalletNetwork.PUBLIC) {
  throw new Error('Please switch to Public network');
}
```

---

## 8. Real-World Usage Examples

The kit is production-tested in:
- https://lab.stellar.org/ (Official Stellar Lab)
- https://swap.xbull.app/ (xBull Swap)
- https://mainnet.blend.capital/ (Blend lending protocol)
- https://app.fxdao.io/ (FX DAO)
- https://app.sorobandomains.org/ (Soroban Domains)
- https://stellar.cables.finance/ (Cables Finance)

---

## 9. Storage Behavior

### Automatic Persistence
- **Triggers**: User connects wallet, changes network, selects different derivation path
- **Storage**: Browser's localStorage
- **Scope**: Domain-specific (cleared on same-domain navigation)
- **Capacity**: ~5-10MB depending on browser
- **Expiration**: Never (persists until user clears browser data)

### Manual Clearing
```typescript
// Disconnect clears all persisted wallet data
await kit.disconnect();

// Specific removal
import { removeAddress, removeMnemonicPath } from '@creit.tech/stellar-wallets-kit';
removeAddress();      // Clears activeAddress
removeMnemonicPath(); // Clears hardware wallet path
```

---

## 10. TypeScript Types

```typescript
// Main types available for import
export interface ISupportedWallet {
  id: string;
  name: string;
  type: string;
  isAvailable: boolean;
  isPlatformWrapper: boolean;
  icon: string;
  url: string;
}

export interface KitActions {
  getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }>;
  signTransaction(xdr: string, opts?: {...}): Promise<{ signedTxXdr: string; signerAddress?: string }>;
  signAuthEntry(authEntry: string, opts?: {...}): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
  signMessage(message: string, opts?: {...}): Promise<{ signedMessage: string; signerAddress?: string }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
  disconnect?(): Promise<void>;
}

export enum ModuleType {
  HW_WALLET = "HW_WALLET",
  HOT_WALLET = "HOT_WALLET",
  BRIDGE_WALLET = "BRIDGE_WALLET",
  AIR_GAPED_WALLET = "AIR_GAPED_WALLET"
}
```

---

## Summary

The Stellar Wallets Kit provides:
1. **Automatic localStorage persistence** of wallet connection state
2. **Implicit auto-reconnect** through reactive state management (RxJS)
3. **11+ wallet support** with unified API
4. **Built-in UI components** (button & modal) that handle persistence
5. **Hardware wallet support** with path management
6. **WalletConnect integration** with session persistence
7. **Type-safe** TypeScript API with full documentation

**Key insight**: The kit does NOT explicitly call "auto-reconnect" methods - instead, it automatically loads and emits persisted state on initialization, allowing your application to reactively restore the UI.
