// ZK credential management for anonymous voting
import { buildPoseidon } from "circomlibjs";

export interface ZKCredentials {
  secret: string;
  salt: string;
  commitment: string;
}

// Generate random ZK credentials
export async function generateZKCredentials(): Promise<ZKCredentials> {
  const poseidon = await buildPoseidon();

  // Generate random secret and salt (32 bytes each -> 256 bits)
  const secret = BigInt("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join(""));

  const salt = BigInt("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join(""));

  // Compute commitment: Poseidon(secret, salt)
  const commitment = poseidon.F.toString(poseidon([secret, salt]));

  return {
    secret: secret.toString(),
    salt: salt.toString(),
    commitment,
  };
}

// Store ZK credentials in localStorage (indexed by DAO ID and public key)
// Uses the same format as manual registration in DAODashboard
export function storeZKCredentials(daoId: number, publicKey: string, credentials: ZKCredentials, leafIndex: number = 0) {
  const key = `voting_registration_${daoId}_${publicKey}`;
  localStorage.setItem(key, JSON.stringify({
    secret: credentials.secret,
    salt: credentials.salt,
    commitment: credentials.commitment,
    leafIndex,
    registeredAt: Date.now(),
  }));
  console.log(`Stored ZK credentials for DAO ${daoId}, user ${publicKey.substring(0, 8)}...`);
}

// Retrieve ZK credentials from localStorage
export function getZKCredentials(daoId: number, publicKey: string): { secret: string; salt: string; commitment: string; leafIndex: number } | null {
  const key = `voting_registration_${daoId}_${publicKey}`;
  const stored = localStorage.getItem(key);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Compute commitment from secret and salt
export async function computeCommitment(secret: string, salt: string): Promise<string> {
  const poseidon = await buildPoseidon();
  const commitment = poseidon.F.toString(poseidon([BigInt(secret), BigInt(salt)]));
  return commitment;
}
