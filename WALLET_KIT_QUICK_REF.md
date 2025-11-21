# Stellar Wallets Kit - Quick Reference

## One-Minute Overview

The kit automatically:
- Saves wallet address + selected wallet type to localStorage
- Restores connection on page reload
- Manages 11 Stellar wallet types with one API
- Provides button/modal UI components

## Key Features

| Feature | Built-in? | Notes |
|---------|-----------|-------|
| localStorage persistence | Yes | Automatic, no config needed |
| Auto-reconnect | Implicit | Through RxJS observables |
| UI Button component | Yes | Fully featured, customizable |
| UI Modal component | Yes | Wallet selection modal |
| Hardware wallet support | Yes | Ledger, Trezor, paths tracked |
| WalletConnect | Yes | Sessions persisted separately |
| Theme customization | Yes | Modal + Button themes |

---

## Usage Patterns

### Minimal Setup

```typescript
import { StellarWalletsKit, WalletNetwork, allowAllModules } from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
});

// Use built-in button (handles everything)
await kit.createButton({
  container: document.getElementById('wallet-btn'),
  onConnect: ({ address }) => console.log('Connected:', address),
  onDisconnect: () => console.log('Disconnected'),
});
```

### Auto-Reconnect Pattern

```typescript
import { activeAddress$ } from '@creit.tech/stellar-wallets-kit';

// Kit auto-restores state on init, observable fires immediately
activeAddress$.subscribe(address => {
  if (address) {
    // Already connected - restore UI
    showDashboard(address);
  } else {
    // Not connected - show connect button
    showConnectButton();
  }
});
```

### Custom Button Integration

```typescript
kit.assignButtons({
  connectEl: '#connect-btn',
  disconnectEl: '#disconnect-btn',
  onConnect: ({ address }) => {
    // Automatically persisted
    setUserAddress(address);
  },
  onDisconnect: () => {
    // Automatically cleared
    clearUserAddress();
  }
});
```

### Manual State Access

```typescript
import { 
  setAddress, 
  removeAddress, 
  hardwareWalletPaths$ 
} from '@creit.tech/stellar-wallets-kit';

// Manual persistence
setAddress('GXXXXX...');

// Listen to hardware wallet paths
hardwareWalletPaths$.subscribe(paths => {
  console.log('Saved paths:', paths);
});

// Clear
removeAddress();
```

---

## localStorage Keys (Implementation Detail)

| Key | Type | Persisted By |
|-----|------|--------------|
| activeAddress | string | Kit + Elf |
| selectedModuleId | string | Kit + Elf |
| mnemonicPath | string | Kit (hardware wallets) |
| hardwareWalletPaths | JSON array | Kit (hardware wallets) |
| wcSessionPaths | JSON object | Kit (WalletConnect) |
| usedWalletsIds | JSON array | Kit (recent wallets) |

---

## Supported Wallets (11 Total)

**Hot Wallets (8):**
- xBull, Albedo, Freighter, Rabet, Lobstr, Hana, Hot Wallet, Klever

**Hardware Wallets (2):**
- Ledger, Trezor

**Bridge:**
- WalletConnect

---

## Common Tasks

### Get Connected Address
```typescript
const { address } = await kit.getAddress();
```

### Check Network
```typescript
const { networkPassphrase } = await kit.getNetwork();
if (networkPassphrase !== WalletNetwork.PUBLIC) {
  throw new Error('Switch to Public network');
}
```

### Sign Transaction
```typescript
const { signedTxXdr } = await kit.signTransaction(xdrString, {
  address: userAddress,
  networkPassphrase: WalletNetwork.PUBLIC
});
```

### Sign Message
```typescript
const { signedMessage } = await kit.signMessage('msg', {
  address: userAddress
});
```

### Disconnect
```typescript
await kit.disconnect();
// localStorage automatically cleared
```

### See Available Wallets
```typescript
const wallets = await kit.getSupportedWallets();
// Returns list with isAvailable flag for each
```

---

## Subscription Cleanup (Important!)

```typescript
// WRONG - memory leak!
activeAddress$.subscribe(...)

// RIGHT - in React
useEffect(() => {
  const sub = activeAddress$.subscribe(...);
  return () => sub.unsubscribe();
}, []);

// RIGHT - standalone
const sub = activeAddress$.subscribe(...);
// Later: sub.unsubscribe();
```

---

## Observables Available

```typescript
// Core state
activeAddress$           // string | undefined
selectedNetwork$         // WalletNetwork | undefined
mnemonicPath$            // string | undefined
hardwareWalletPaths$     // { publicKey; index }[]

// Config
allowedWallets$          // ISupportedWallet[]
horizonUrl$              // string | undefined
modalTheme$              // IModalTheme | undefined
buttonTheme$             // IButtonTheme | undefined
```

---

## Common Gotchas

1. **Multiple instances**: Create kit ONCE, globally
   ```typescript
   // app.ts
   export const kit = new StellarWalletsKit({...});
   
   // other-file.ts
   import { kit } from './app';
   ```

2. **Network validation**: Always check network before signing
   ```typescript
   const net = await kit.getNetwork();
   if (net.networkPassphrase !== targetNetwork) throw new Error(...);
   ```

3. **Path handling**: Hardware wallets need explicit BIP44 paths
   ```typescript
   await kit.getAddress({ path: "44'/148'/0'" })
   ```

4. **WalletConnect config**: Requires projectId
   ```typescript
   new WalletConnectModule({ 
     projectId: 'xxx',
     name: 'MyApp'
   })
   ```

5. **Modal callbacks**: Ensure proper cleanup
   ```typescript
   onClosed: (err) => {
     // called if user closes without selecting
   }
   ```

---

## Configuration Templates

### Full Config with All Wallets
```typescript
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FreighterModule,
  LedgerModule,
  TrezorModule,
  WalletConnectModule
} from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  modules: [
    ...allowAllModules(),
    new LedgerModule(),
    new TrezorModule({ /* config */ }),
    new WalletConnectModule({ 
      projectId: process.env.WALLET_CONNECT_PROJECT_ID,
      name: 'DaoVote'
    })
  ],
  modalTheme: {
    bgColor: '#fff',
    textColor: '#000',
    // ... other theme props
  }
});
```

### Minimal Config (Hot Wallets Only)
```typescript
import { 
  StellarWalletsKit, 
  WalletNetwork, 
  FreighterModule,
  xBullModule
} from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [
    new FreighterModule(),
    new xBullModule()
  ]
});
```

---

## Related Resources

- **Official Docs**: https://stellarwalletskit.dev/
- **GitHub**: https://github.com/Creit-Tech/Stellar-Wallets-Kit
- **NPM**: https://www.npmjs.com/package/@creit.tech/stellar-wallets-kit
- **Stellar Docs**: https://developers.stellar.org/docs/tools/developer-tools/wallets

