# DaoVote Deployment Scripts

Automated deployment scripts for DaoVote anonymous voting system on Stellar Soroban.

## Prerequisites

1. **Stellar CLI** installed:
   ```bash
   cargo install stellar-cli  # ensure version matches soroban host (see rust-toolchain.toml)
   ```

2. **Stellar network running** (choose one):
   - **Local P25 network** (recommended for development):
     ```bash
     docker run --rm -d --name stellar -p 8000:8000 stellar/quickstart:future --futurenet
     ```
   - **Stellar Futurenet** (for testing with shared network)

3. **Account with funds**:
   ```bash
   # Generate account
   stellar keys generate mykey
   
   # Fund on local network
   stellar keys fund mykey --network local
   
   # OR fund on futurenet
   stellar keys fund mykey --network futurenet
   ```

4. **Contracts built**:
   ```bash
   cargo build --target wasm32v1-none --release
   ```

## Quick Start

### Local Deployment

```bash
# 1. Deploy all contracts with constructors
./scripts/deploy-local.sh

# 2. Configure backend with relayer key
./scripts/init-local.sh

# 3. Start backend relayer
cd backend
npm install
npm run dev
```

### Futurenet Deployment

```bash
# 1. Set network to futurenet
export NETWORK=futurenet

# 2. Deploy contracts
./scripts/deploy-local.sh

# 3. Configure backend
./scripts/init-local.sh

# 4. Start backend
cd backend
npm install
npm run dev
```

## Scripts

### `run_budget_sim.sh`
Simulate `set_vk`, `create_proposal`, and `vote` against WASM using `soroban contract invoke --simulate` to capture CPU/mem for budget baselines.

**Usage:**
```bash
./scripts/run_budget_sim.sh \
  target/wasm32v1-none/release/voting.wasm \
  target/wasm32v1-none/release/dao_registry.wasm \
  target/wasm32v1-none/release/membership_sbt.wasm \
  target/wasm32v1-none/release/membership_tree.wasm
```
If omitted, defaults to the release WASMs above.

**Note:** Requires `soroban` CLI configured for your target network (local/futurenet) and a funded key. Outputs CPU/mem metrics you can apply to `tests/integration/tests/budget_smoke.rs`.
**Env checklist before running:**
- `STELLAR_NETWORK_PASSPHRASE` (e.g., futurenet passphrase)
- `STELLAR_RPC_URL` (e.g., http://localhost:8000/soroban/rpc)
- `SOURCE` (funded key name from `stellar keys list`)

### `deploy-local.sh`

Deploys all contracts in dependency order with constructor arguments.

**Usage:**
```bash
./scripts/deploy-local.sh
```

**Environment variables:**
- `NETWORK` - Network name (default: `local`)
- `SOURCE` - Deployer account key name (default: `mykey`)
- `WASM_DIR` - WASM files directory (default: `target/wasm32v1-none/release`)

**Output:**
- Creates `.contract-ids.local` with deployed contract addresses

**Deployment order:**
1. **DAORegistry** (no constructor)
2. **MembershipSBT** (constructor: `registry`)
3. **MembershipTree** (constructor: `sbt_contract`)
4. **Voting** (constructor: `tree_contract`)

**Constructor arguments:**
```bash
# MembershipSBT
-- --registry <REGISTRY_ID>

# MembershipTree
-- --sbt_contract <SBT_ID>

# Voting
-- --tree_contract <TREE_ID>
```

### `init-local.sh`

Configures backend environment after deployment.

**Usage:**
```bash
./scripts/init-local.sh
```

**Environment variables:**
- `RELAYER_KEY` - Relayer key name (default: `relayer`)

**Actions:**
1. Generates or uses existing relayer key
2. Funds relayer account (local network only)
3. Creates `backend/.env` with:
   - Network configuration
   - Relayer secret key (secure)
   - Contract addresses
   - Server configuration

**Output:**
- Creates `backend/.env` (gitignored)
- Never commits secrets to version control

**Security notes:**
- Relayer secret key is randomly generated
- `backend/.env` is automatically in `.gitignore`
- Never share or commit `.env` files

## Contract Dependencies

```
DAORegistry (no deps)
    ↓
MembershipSBT (needs: registry)
    ↓
MembershipTree (needs: sbt_contract)
    ↓
Voting (needs: tree_contract)
```

## Generated Files

### `.contract-ids.local`
```bash
# DaoVote Contract IDs (local network)
# Generated: <timestamp>
NETWORK=local
REGISTRY_ID=CXXX...
SBT_ID=CXXX...
TREE_ID=CXXX...
VOTING_ID=CXXX...
```

### `backend/.env`
```bash
# DaoVote Relayer Configuration
# Generated: <timestamp>
# Network: local

# Network Configuration
SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
NETWORK_PASSPHRASE=Standalone Network ; February 2017

# Relayer Account
# WARNING: Keep this secret secure!
RELAYER_SECRET_KEY=SXXX...

# Contract Addresses
VOTING_CONTRACT_ID=CXXX...
TREE_CONTRACT_ID=CXXX...

# Server Configuration
PORT=3001
```

## Troubleshooting

### "WASM files not found"
Build contracts first:
```bash
cargo build --target wasm32v1-none --release
```

### "Account not found"
Fund the account:
```bash
stellar keys fund mykey --network local
```

### "Network not running"
Start the local network:
```bash
docker run --rm -d --name stellar -p 8000:8000 stellar/quickstart:future --futurenet
```

### "Constructor argument error"
Ensure stellar CLI is up to date:
```bash
cargo install stellar-cli --force
```

### "Relayer account not funded"
Fund manually:
```bash
stellar keys fund relayer --network local
```

## Advanced Usage

### Custom Network

```bash
# Deploy to custom network
export NETWORK=testnet
export SOURCE=admin-key
./scripts/deploy-local.sh
./scripts/init-local.sh
```

### Redeployment

```bash
# Remove old contract IDs
rm -f .contract-ids.local

# Remove old backend config
rm -f backend/.env

# Redeploy
./scripts/deploy-local.sh
./scripts/init-local.sh
```

### Manual Deployment

If you need to deploy contracts manually:

```bash
# 1. Deploy Registry
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/dao_registry.wasm \
  --source mykey --network local)

# 2. Deploy SBT with registry arg
SBT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_sbt.wasm \
  --source mykey --network local \
  -- --registry $REGISTRY_ID)

# 3. Deploy Tree with SBT arg
TREE_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_tree.wasm \
  --source mykey --network local \
  -- --sbt_contract $SBT_ID)

# 4. Deploy Voting with Tree arg
VOTING_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/voting.wasm \
  --source mykey --network local \
  -- --tree_contract $TREE_ID)
```

## Security Considerations

1. **Secret Keys**
   - Never commit `backend/.env` to version control
   - Never share relayer secret keys
   - Use separate keys for testnet and mainnet

2. **Network Security**
   - Use HTTPS RPC URLs in production
   - Verify network passphrases
   - Monitor relayer account balance

3. **Contract Upgrades**
   - Contracts are immutable after deployment
   - Test thoroughly on testnet before mainnet
   - Plan upgrade strategy using contract wrappers

## Next Steps

After deployment:
1. Create a DAO: `stellar contract invoke --id $REGISTRY_ID -- create_dao`
2. Mint membership SBTs to members
3. Add members to Merkle tree
4. Set verification key for Groth16 proofs
5. Create proposals and start voting

See main README.md for complete usage guide.
