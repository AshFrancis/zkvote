# DaoVote Backend Services

Simple relayer service for anonymous vote submission on local P25 network.

## Overview

The relayer provides anonymity by submitting vote transactions on behalf of users:
- User generates ZK proof off-chain
- User sends vote request to relayer
- Relayer submits tx using its own funded account
- Transaction source ≠ voter (anonymity preserved)

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Local P25 Network
SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
NETWORK_PASSPHRASE=Standalone Network ; February 2017

# Relayer account (must be funded)
RELAYER_SECRET_KEY=SXXXX...

# Contract addresses (from deployment)
VOTING_CONTRACT_ID=CXXXX...
TREE_CONTRACT_ID=CXXXX...

PORT=3001
# Optional hardening
RELAYER_AUTH_TOKEN=shared-secret          # gates write/config endpoints
LOG_CLIENT_IP=hash                        # hash IPs (or omit to drop)
STRIP_REQUEST_BODIES=true                 # drop request bodies from logs/handlers in prod
VOTING_VK_VERSION=1                       # optional pinned vk version
```

### 3. Create Relayer Account

```bash
# Generate relayer key
stellar keys generate relayer

# Get secret key
stellar keys show relayer

# Fund it
stellar keys fund relayer --network local
```

### 4. Start Relayer

```bash
npm run relayer

# Or with auto-reload:
npm run dev:relayer
```

## API Endpoints

### Health Check
```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "relayer": "GXXX...",
  "votingContract": "CXXX...",
  "treeContract": "CXXX..."
}
```

### Submit Anonymous Vote
```bash
POST /vote
Content-Type: application/json

{
  "daoId": 1,
  "proposalId": 1,
  "choice": true,
  "nullifier": "0x123...",   // < BN254 modulus, 32 bytes max
  "root": "0xabc...",       // < BN254 modulus, 32 bytes max
  "proof": {
    "a": "0x...",  // 64 bytes (G1 point)
    "b": "0x...",  // 128 bytes (G2 point)
    "c": "0x..."   // 64 bytes (G1 point)
  }
}
```

Response:
```json
{
  "success": true,
  "txHash": "abc123...",
  "status": "SUCCESS"
}
```

### Get Vote Results
```bash
GET /proposal/:daoId/:proposalId
```

Response:
```json
{
  "daoId": "1",
  "proposalId": "1",
  "yesVotes": 5,
  "noVotes": 3
}
```

### Get Current Merkle Root
```bash
GET /root/:daoId
```

Response:
```json
{
  "daoId": "1",
  "root": "0x..."
}
```

## Example Usage

```bash
# Check health
curl http://localhost:3001/health

# Submit vote
curl -X POST http://localhost:3001/vote \
  -H "Content-Type: application/json" \
  -d '{
    "daoId": 1,
    "proposalId": 1,
    "choice": true,
    "nullifier": "0x0000000000000000000000000000000000000000000000000000000000000001",
    "root": "0x0000000000000000000000000000000000000000000000000000000000000abc",
    "proof": {
      "a": "0x0000...0001",
      "b": "0x0000...0002",
      "c": "0x0000...0003"
    }
  }'

# Get results
curl http://localhost:3001/proposal/1/1

# Get Merkle root
curl http://localhost:3001/root/1
```

## Security Notes

- Relayer account pays all transaction fees
- Rate limiting should be added for production
- Consider adding request signing/authentication
- IP throttling recommended to prevent spam
- Never expose relayer secret key

## Production (Future)

When P25 reaches testnet/mainnet:
1. Swap local RPC URL for public endpoint
2. Consider integrating with Launchtube for advanced fee management
3. Add proper rate limiting and monitoring
4. Deploy to cloud service with DDoS protection

## Architecture

```
User (off-chain)
  ├── Generate identity secrets (secret, salt)
  ├── Compute commitment = Poseidon(secret, salt)
  ├── Generate ZK proof (Circom/SnarkJS)
  └── Send vote request to relayer
         │
         ▼
Relayer (this service)
  ├── Validates request
  ├── Builds Soroban transaction
  ├── Signs with relayer account
  └── Submits to network
         │
         ▼
Voting Contract (on-chain)
  ├── Verifies Merkle root is valid
  ├── Checks nullifier not spent
  ├── Verifies Groth16 proof (BN254 pairing)
  └── Records vote (anonymous)
```

The key insight: **transaction source (relayer) ≠ voter identity**, providing anonymity at the blockchain level. The ZK proof provides anonymity at the vote level (no one knows which commitment voted which way).
