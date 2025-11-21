# Stellar Wallets Kit - Architecture & Data Flow

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Your DaoVote Application                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  UI Components (Button, Modal, Dashboard)                        │
│         ↑                              ↓                          │
│    RxJS Observables           Connection Events                  │
│  (activeAddress$, etc.)    (onConnect, onDisconnect)             │
│         ↑                              ↓                          │
└─────────────────────────────────────────────────────────────────┘
           ↑                              ↓
           │                              │
┌──────────┴──────────────────────────────┴──────────────────┐
│                                                             │
│         Stellar Wallets Kit (StellarWalletsKit)            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Store (@ngneat/elf + RxJS)                         │  │
│  │                                                      │  │
│  │  - activeAddress$      [Observable]                 │  │
│  │  - selectedNetwork$    [Observable]                 │  │
│  │  - hardwareWalletPaths$[Observable]                 │  │
│  │  - mnemonicPath$       [Observable]                 │  │
│  │                                                      │  │
│  │  - setAddress()        [Setter]                     │  │
│  │  - removeAddress()     [Setter]                     │  │
│  │  - setNetwork()        [Setter]                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                         ↑↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Persistence Layer (localStorage Sync)              │  │
│  │                                                      │  │
│  │  Automatic save on:                                 │  │
│  │  - User connects (activeAddress)                    │  │
│  │  - Wallet changes (selectedModuleId)                │  │
│  │  - Path changes (mnemonicPath)                      │  │
│  │  - Hardware wallet (hardwareWalletPaths)            │  │
│  │  - WalletConnect (wcSessionPaths)                   │  │
│  └─────────────────────────────────────────────────────┘  │
│                         ↑↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Wallet Module Manager                              │  │
│  │                                                      │  │
│  │  11 Wallet Adapters:                                │  │
│  │  - FreighterModule      - xBullModule               │  │
│  │  - AlbedoModule         - RabetModule               │  │
│  │  - LobstrModule         - HanaModule                │  │
│  │  - HotWalletModule      - KleverModule              │  │
│  │  - LedgerModule         - TrezorModule              │  │
│  │  - WalletConnectModule                              │  │
│  └─────────────────────────────────────────────────────┘  │
│                         ↓                                   │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                 Stellar Wallets (Extensions, Web3, USB)         │
│                                                                  │
│  Freighter, xBull, Albedo, Ledger, Trezor, WalletConnect, etc. │
└─────────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                   Stellar Blockchain Network                    │
│                                                                  │
│  PUBLIC | TESTNET | FUTURENET | SANDBOX | STANDALONE           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Connection & Auto-Reconnect

### On Page Load (First Time)

```
Page Load
   ↓
StellarWalletsKit.constructor()
   ↓
Load from localStorage
   │
   ├─ activeAddress? → No
   ├─ selectedModuleId? → No
   ├─ hardwareWalletPaths? → No
   └─ wcSessionPaths? → No
   ↓
Observable activeAddress$ emits: undefined
   ↓
Your app: Show "Connect Wallet" button
```

### User Connects Wallet

```
User clicks "Connect" button
   ↓
kit.openModal({ onWalletSelected })
   ↓
User selects wallet (e.g., Freighter)
   ↓
kit.setWallet(FREIGHTER_ID)
   ↓
kit.getAddress()
   ↓
Freighter extension prompts user
   ↓
User approves
   ↓
getAddress() returns { address: "GXXXXX..." }
   ↓
Kit AUTOMATICALLY:
├─ Calls setAddress("GXXXXX...")
├─ Saves to store
├─ Persists to localStorage
└─ Observable activeAddress$ emits new value
   ↓
Your app: Show dashboard with address
```

### On Page Load (After Connection)

```
Page Load
   ↓
StellarWalletsKit.constructor()
   ↓
Load from localStorage
   │
   ├─ activeAddress = "GXXXXX..."  ← FOUND!
   ├─ selectedModuleId = "FREIGHTER_ID"  ← FOUND!
   └─ hardwareWalletPaths = []
   ↓
Store initialized with persisted values
   ↓
Observable activeAddress$ emits: "GXXXXX..."
   ↓
Your subscription fires IMMEDIATELY
   ↓
Your app: AUTO-RECONNECTED! Show dashboard with address
```

### User Disconnects

```
User clicks "Disconnect" button
   ↓
kit.disconnect()
   ↓
Kit AUTOMATICALLY:
├─ Calls removeAddress()
├─ Clears selectedModuleId
├─ Clears hardwareWalletPaths (if any)
├─ Deletes from localStorage
└─ Observable activeAddress$ emits: undefined
   ↓
Your subscription fires
   ↓
Your app: Show "Connect Wallet" button again
```

---

## State Persistence Flow

### What Gets Saved

```
User Action
   ↓
        ┌──────────────────────────────┐
        │  Kit Function                │
        │  (getAddress, setWallet...)  │
        └──────────────────────────────┘
                   ↓
        ┌──────────────────────────────┐
        │  Store Update                │
        │  (@ngneat/elf)               │
        └──────────────────────────────┘
                   ↓
        ┌──────────────────────────────┐
        │  Elf Effect Triggered        │
        │  (on state change)           │
        └──────────────────────────────┘
                   ↓
        ┌──────────────────────────────┐
        │  localStorage.setItem()      │
        │  (automatic)                 │
        └──────────────────────────────┘
                   ↓
        ┌──────────────────────────────┐
        │  Observable emits new value  │
        │  (RxJS subscription fires)   │
        └──────────────────────────────┘
                   ↓
        ┌──────────────────────────────┐
        │  Your app updates            │
        │  (reactive update)           │
        └──────────────────────────────┘
```

---

## localStorage Keys Reference

```typescript
// Keys saved by the kit (all automatic)

activeAddress: string
  Key: "activeAddress"
  Value: "GXXXXX..." (public key)
  Saved: When user connects
  Cleared: When user disconnects

selectedModuleId: string
  Key: "selectedModuleId"
  Value: "FREIGHTER_ID" | "XBULL_ID" | etc
  Saved: When wallet is selected
  Cleared: When user disconnects

mnemonicPath: string
  Key: "mnemonicPath"
  Value: "44'/148'/0'" (BIP44 path)
  Saved: When hardware wallet path is set
  Cleared: When hardware wallet is disconnected

hardwareWalletPaths: object[]
  Key: "hardwareWalletPaths"
  Value: [{ publicKey, index }, ...]
  Saved: For Ledger/Trezor multi-account support
  Cleared: On hardware wallet disconnect

wcSessionPaths: object
  Key: "wcSessionPaths"
  Value: { publicKey: topic, ... }
  Saved: When WalletConnect session created
  Cleared: When session ends

usedWalletsIds: string[]
  Key: "usedWalletsIds"
  Value: ["FREIGHTER_ID", "XBULL_ID"]
  Saved: For quick access to recently used
  Cleared: Never (user preference tracking)
```

---

## API Call Sequence

### Typical Usage Flow

```typescript
// 1. INIT
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules()
});
// At this point:
// - Kit loads persisted state from localStorage
// - Observables emit if data found
// - No network calls yet

// 2. CREATE UI (option A: built-in button)
await kit.createButton({
  container: element,
  onConnect: handleConnect,      // Called after user selects wallet
  onDisconnect: handleDisconnect // Called when user clicks disconnect
});
// Button is rendered and ready
// If localStorage had activeAddress, button shows "Disconnect" + address

// 3. CREATE UI (option B: custom buttons)
kit.assignButtons({
  connectEl: element,
  disconnectEl: element,
  onConnect: handleConnect,
  onDisconnect: handleDisconnect
});

// 4. LISTEN TO STATE
activeAddress$.subscribe(address => {
  if (address) {
    // Connected - show dashboard
  } else {
    // Not connected - show connect button
  }
});
// This fires immediately if localStorage has data!

// 5. USER INTERACTION
// User clicks connect → openModal() → selects wallet → getAddress()

// 6. KIT AUTOMATICALLY
// - Calls wallet extension
// - Gets address
// - Saves to localStorage
// - Emits observable
// - Your listeners fire
// - UI updates

// 7. SIGN TRANSACTION
const { signedTxXdr } = await kit.signTransaction(xdr, {
  address: userAddress,
  networkPassphrase: WalletNetwork.TESTNET
});
// Address already known from localStorage!

// 8. DISCONNECT
await kit.disconnect();
// - Clears localStorage
// - Emits undefined
// - Your listeners fire
// - UI reverts to "Connect" button
```

---

## Memory & Performance

### localStorage Usage
- Typical size: 200-500 bytes (just address + wallet ID)
- Total capacity: 5-10MB (browser dependent)
- No performance impact

### Observable Subscriptions
- Each subscription holds a reference
- MUST unsubscribe on cleanup to prevent memory leaks
- RxJS handles cleanup automatically if used with `takeUntil()` operator

### Network Calls
- Only when explicitly called: `getAddress()`, `signTransaction()`, etc.
- No background polling
- No automatic network activity

---

## Error Handling Flow

```
User Action (e.g., getAddress)
    ↓
Wallet Extension Called
    ↓
    ├─ User Approves
    │  ↓
    │  Returns address
    │  ↓
    │  Saved to localStorage
    │  ↓
    │  Observable emits
    │  ↓
    │  Success callback fires
    │
    ├─ User Rejects
    │  ↓
    │  Throws error
    │  ↓
    │  Catch block gets error
    │  ↓
    │  NOT saved to localStorage
    │  ↓
    │  User can retry
    │
    └─ Wallet Not Available
       ↓
       isAvailable() check fails
       ↓
       Marked unavailable in modal
       ↓
       User sees disabled option
```

---

## Summary: What Happens Automatically

```
The Kit:
├─ Initializes store from localStorage  (init)
├─ Subscribes to state changes          (effects)
├─ Syncs changes to localStorage        (persistence)
├─ Manages 11 wallet modules            (adapters)
├─ Exposes state through observables    (RxJS)
├─ Provides UI components               (button/modal)
└─ Handles cleanup on disconnect        (disconnect)

Your App Needs To:
├─ Create kit instance once             (singleton)
├─ Subscribe to observables             (with cleanup!)
├─ Handle connection callbacks          (onConnect)
├─ Handle disconnection callbacks       (onDisconnect)
├─ Validate network before signing      (safety)
└─ Show appropriate UI based on state   (reactive)

Result:
├─ Zero localStorage management code
├─ Automatic page reload reconnection
├─ Type-safe wallet interactions
├─ Support for all major Stellar wallets
└─ Production-ready wallet UX
```

