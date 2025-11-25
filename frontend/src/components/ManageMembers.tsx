import { useState, useEffect } from 'react';
import { initializeContractClients } from '../lib/contracts';
import { getReadOnlyDaoRegistry, getReadOnlyMembershipSbt, getReadOnlyMembershipTree, getReadOnlyVoting } from '../lib/readOnlyContracts';
import { useWallet } from '../hooks/useWallet';
import {
  getOrDeriveEncryptionKey,
  encryptAlias,
  decryptAlias,
  clearEncryptionKeyFromSession,
} from '../lib/encryption';

interface ManageMembersProps {
  publicKey: string | null;
  daoId: number;
  daoName: string;
  isAdmin: boolean;
  isInitializing?: boolean;
}

interface TreeInfo {
  depth: number;
  leafCount: number;
  root: string;
  vkVersion: number | null;
}

interface Member {
  address: string;
  hasSBT: boolean;
  registered: boolean;
  isAdmin?: boolean;
}

export default function ManageMembers({ publicKey, daoId, daoName, isAdmin, isInitializing = false }: ManageMembersProps) {
  const { kit } = useWallet();
  const [loading, setLoading] = useState(() => {
    // Only show loading indicator if no cache exists
    const treeCacheKey = `tree_info_${daoId}`;
    const membersCacheKey = `members_${daoId}`;
    const hasTreeCache = localStorage.getItem(treeCacheKey);
    const hasMembersCache = localStorage.getItem(membersCacheKey);
    return !hasTreeCache && !hasMembersCache;
  });
  const [error, setError] = useState<string | null>(null);
  const [treeInfo, setTreeInfo] = useState<TreeInfo | null>(null);
  const [mintAddress, setMintAddress] = useState("");
  const [minting, setMinting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [removedMembers, setRemovedMembers] = useState<string[]>([]);
  const [adminAddress, setAdminAddress] = useState<string>("");
  const [memberAlias, setMemberAlias] = useState<string>("");
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | null>(null);
  const [memberAliases, setMemberAliases] = useState<Map<string, string>>(new Map());
  const [encryptedAliases, setEncryptedAliases] = useState<Map<string, string>>(new Map());
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState<string>("");
  const [updatingAlias, setUpdatingAlias] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [aliasesVisible, setAliasesVisible] = useState(false);
  const [aliasInputUnlocked, setAliasInputUnlocked] = useState(false);

  const signMessage = async (message: string): Promise<string | Uint8Array<ArrayBufferLike>> => {
    if (!kit?.signMessage) {
      throw new Error("Wallet does not support message signing");
    }
    const res = await kit.signMessage(message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (res as any).signedMessage ?? res;
  };

  useEffect(() => {
    // Wait for wallet initialization before loading
    if (isInitializing) {
      console.log('[ManageMembers] Waiting for wallet initialization...');
      return;
    }
    console.log('[ManageMembers] Loading tree info for DAO:', daoId, 'publicKey:', publicKey);
    loadTreeInfo();
  }, [daoId, isInitializing]);

  // Load encrypted aliases when members change (for all users)
  useEffect(() => {
    console.log('[useEffect] Members changed, loading aliases');
    if (members.length > 0) {
      loadEncryptedAliases();
    }
  }, [members]);

  // Reload aliases when encryption key becomes available (for decryption)
  useEffect(() => {
    console.log('[useEffect] encryptionKey changed, isAdmin:', isAdmin, 'hasKey:', !!encryptionKey);
    if (isAdmin && encryptionKey && encryptedAliases.size > 0) {
      console.log('[useEffect] Calling decryptAliases()');
      decryptAliases();
    }
  }, [encryptionKey, encryptedAliases]);

  const loadEncryptedAliases = async () => {
    if (members.length === 0) return;

    console.log('[loadEncryptedAliases] Loading encrypted aliases for', members.length, 'members');

    try {
      // Use read-only client to fetch aliases (doesn't require wallet)
      const membershipSbt = getReadOnlyMembershipSbt();
      const encrypted = new Map<string, string>();

      for (const member of members) {
        console.log(`[loadEncryptedAliases] Checking member:`, member.address.substring(0, 8));
        try {
          // Fetch encrypted alias from contract
          const encryptedAlias = await membershipSbt.get_alias({
            dao_id: BigInt(daoId),
            member: member.address,
          });

          console.log(`[loadEncryptedAliases] Contract response for ${member.address.substring(0, 8)}:`, encryptedAlias);

          if (encryptedAlias.result) {
            encrypted.set(member.address, encryptedAlias.result);
          } else {
            console.log(`[loadEncryptedAliases] No alias stored for ${member.address.substring(0, 8)}`);
          }
        } catch (err) {
          // Alias may not exist for this member, skip
          console.error(`[loadEncryptedAliases] Error fetching alias for ${member.address}:`, err);
        }
      }

      console.log('[loadEncryptedAliases] Final encrypted aliases map size:', encrypted.size);
      setEncryptedAliases(encrypted);
    } catch (err) {
      console.error('Failed to load encrypted aliases:', err);
    }
  };

  const decryptAliases = () => {
    if (!encryptionKey || encryptedAliases.size === 0) return;

    console.log('[decryptAliases] Decrypting', encryptedAliases.size, 'aliases');
    const decrypted = new Map<string, string>();

    for (const [address, encrypted] of encryptedAliases) {
      console.log(`[decryptAliases] Attempting to decrypt for ${address.substring(0, 8)}`);
      const decryptedValue = decryptAlias(encrypted, encryptionKey);
      console.log(`[decryptAliases] Decryption result:`, decryptedValue);
      if (decryptedValue) {
        decrypted.set(address, decryptedValue);
      } else {
        console.log(`[decryptAliases] Decryption failed for ${address.substring(0, 8)}`);
      }
    }

    console.log('[decryptAliases] Final decrypted aliases map size:', decrypted.size);
    setMemberAliases(decrypted);
  };

  const loadMembers = async (admin?: string) => {
    const membersCacheKey = `members_${daoId}`;

    try {
      // Always use read-only client for loading members (view-only operation)
      const membershipSbt = getReadOnlyMembershipSbt();

      // Get member count from contract
      const countResult = await membershipSbt.get_member_count({
        dao_id: BigInt(daoId),
      });

      const count = Number(countResult.result);
      console.log(`[loadMembers] Found ${count} members in contract`);

      if (count === 0) {
        setMembers([]);
        localStorage.setItem(membersCacheKey, JSON.stringify([]));
        return;
      }

      // Fetch all members in one batch (limit 100)
      const batchSize = 100;
      const limit = Math.min(batchSize, count);
      const membersResult = await membershipSbt.get_members({
        dao_id: BigInt(daoId),
        offset: BigInt(0),
        limit: BigInt(limit),
      });

      // Check SBT status for each member and build member list
      const allMembers: Member[] = [];
      for (const memberAddress of membersResult.result) {
        const hasResult = await membershipSbt.has({
          dao_id: BigInt(daoId),
          of: memberAddress,
        });

        if (hasResult.result) {
          allMembers.push({
            address: memberAddress,
            hasSBT: true,
            registered: false,
            isAdmin: admin ? memberAddress === admin : false,
          });
        }
      }

      console.log(`[loadMembers] Loaded ${allMembers.length} active members`);
      setMembers(allMembers);

      // Cache the members
      localStorage.setItem(membersCacheKey, JSON.stringify(allMembers));
    } catch (err) {
      console.error('[loadMembers] Error loading members:', err);
      setError('Failed to load members from contract');
    }
  };

  const loadTreeInfo = async () => {
    const cacheKey = `tree_info_${daoId}`;
    const membersCacheKey = `members_${daoId}`;

    try {
      setLoading(true);
      setError(null);

      // Load from cache first
      const cachedTreeInfo = localStorage.getItem(cacheKey);
      const cachedMembers = localStorage.getItem(membersCacheKey);

      if (cachedTreeInfo) {
        const cached = JSON.parse(cachedTreeInfo);
        setTreeInfo({
          depth: cached.treeInfo.depth,
          leafCount: cached.treeInfo.leafCount,
          root: cached.treeInfo.root,
          vkVersion: cached.treeInfo.vkVersion ?? null,
        });
        setAdminAddress(cached.adminAddress);
        setLoading(false);
      }

      if (cachedMembers) {
        setMembers(JSON.parse(cachedMembers));
      }

      // Fetch fresh data
      let result;
      let daoResult;
      let vkResult;

      // Try wallet client first if publicKey is available
      if (publicKey) {
        try {
          const clients = initializeContractClients(publicKey);

          // Try to make the actual calls - this is where account check happens
          result = await clients.membershipTree.get_tree_info({
            dao_id: BigInt(daoId),
          });

          daoResult = await clients.daoRegistry.get_dao({
            dao_id: BigInt(daoId),
          });

          const votingClient: any = clients.voting;
          vkResult = await votingClient.vk_version({
            dao_id: BigInt(daoId),
          });
        } catch (err) {
          // Account not found - fallback to read-only
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.log('[loadTreeInfo] Using read-only clients due to error:', errorMessage);

          const membershipTree = getReadOnlyMembershipTree();
          const daoRegistry = getReadOnlyDaoRegistry();
          const voting: any = getReadOnlyVoting();

          result = await membershipTree.get_tree_info({
            dao_id: BigInt(daoId),
          });

          daoResult = await daoRegistry.get_dao({
            dao_id: BigInt(daoId),
          });

          vkResult = await voting.vk_version({
            dao_id: BigInt(daoId),
          });
        }
      } else {
        // No wallet connected - use read-only
        const membershipTree = getReadOnlyMembershipTree();
        const daoRegistry = getReadOnlyDaoRegistry();
        const voting: any = getReadOnlyVoting();

        result = await membershipTree.get_tree_info({
          dao_id: BigInt(daoId),
        });

        daoResult = await daoRegistry.get_dao({
          dao_id: BigInt(daoId),
        });

        vkResult = await voting.vk_version({
          dao_id: BigInt(daoId),
        });
      }

      // get_tree_info returns [depth, leaf_count, root] as a tuple
      const freshTreeInfo = {
        depth: Number(result.result[0]),
        leafCount: Number(result.result[1]),
        root: result.result[2].toString(),
        vkVersion: vkResult?.result !== undefined ? Number(vkResult.result) : null,
      };
      setTreeInfo(freshTreeInfo);

      // Extract admin address from the DAO result we already fetched
      const adminAddr = daoResult.result.admin;
      setAdminAddress(adminAddr);

      // Cache the tree info and admin address
      localStorage.setItem(cacheKey, JSON.stringify({
        treeInfo: freshTreeInfo,
        adminAddress: adminAddr,
      }));

      // Load members from contract
      await loadMembers(adminAddr);
    } catch (err) {
      console.error('Failed to load tree info:', err);
      setError('Failed to load membership data');
    } finally {
      setLoading(false);
    }
  };

  const handleMintSBT = async () => {
    if (!mintAddress.trim()) {
      setError("Address is required");
      return;
    }

    try {
      setMinting(true);
      setError(null);
      setSuccess(null);

      const clients = initializeContractClients(publicKey);

      // Check if address already has an SBT
      const alreadyHas = await clients.membershipSbt.has({
        dao_id: BigInt(daoId),
        of: mintAddress,
      });

      if (alreadyHas.result) {
        setError(`Address ${mintAddress.substring(0, 8)}... already has a membership SBT for this DAO`);
        setMinting(false);
        return;
      }

      // Get or derive encryption key and encrypt alias if provided
      let encryptedAlias: string | undefined = undefined;
      if (memberAlias.trim()) {
        const key = await getOrDeriveEncryptionKey(daoId, signMessage);
        if (!key) {
          setError("Failed to derive encryption key");
          setMinting(false);
          return;
        }

        encryptedAlias = encryptAlias(memberAlias, key);
        setEncryptionKey(key);
      }

      const tx = await clients.membershipSbt.mint({
        dao_id: BigInt(daoId),
        to: mintAddress,
        admin: publicKey,
        encrypted_alias: encryptedAlias,
      });

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      setSuccess(`Successfully minted SBT to ${mintAddress.substring(0, 8)}...${memberAlias ? ` (${memberAlias})` : ''}`);

      setMintAddress("");
      setMemberAlias("");

      // Reload tree info and members
      await loadTreeInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint SBT");
      console.error("Failed to mint SBT:", err);
    } finally {
      setMinting(false);
    }
  };

  // Toggle revealing existing member aliases in the list
  const toggleAliasVisibility = async () => {
    // If currently visible, just hide them (keep the key for next reveal)
    if (aliasesVisible) {
      setAliasesVisible(false);
      return;
    }

    // If not visible, show them (get key if needed)
    try {
      setError(null);
      console.log("[toggleAliasVisibility] Requesting encryption key...");
      const key = await getOrDeriveEncryptionKey(daoId, signMessage);
      console.log("[toggleAliasVisibility] Got encryption key:", !!key);
      if (key) {
        setEncryptionKey(key);  // This will trigger decryptAliases via useEffect
        setAliasesVisible(true);
      } else {
        setError("Failed to unlock aliases - signature was cancelled or failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reveal aliases");
      console.error("Failed to reveal aliases:", err);
    }
  };

  // Toggle unlocking the alias input field for adding new aliases
  const toggleAliasInput = async () => {
    // If currently unlocked, lock it
    if (aliasInputUnlocked) {
      setAliasInputUnlocked(false);
      setMemberAlias("");
      return;
    }

    // If locked, unlock it (get key if needed)
    try {
      setError(null);
      console.log("[toggleAliasInput] Requesting encryption key...");
      const key = await getOrDeriveEncryptionKey(daoId, signMessage);
      console.log("[toggleAliasInput] Got encryption key:", !!key);
      if (key) {
        setEncryptionKey(key);
        setAliasInputUnlocked(true);
      } else {
        setError("Failed to unlock alias input - signature was cancelled or failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock alias input");
      console.error("Failed to unlock alias input:", err);
    }
  };

  const handleRemoveMember = async (address: string) => {
    if (!isAdmin) {
      setError("Only admins can remove members");
      return;
    }

    if (!confirm(`Revoke membership for ${address.substring(0, 8)}...? They will no longer be able to vote.`)) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);

      const clients = initializeContractClients(publicKey);

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      // Step 1: Revoke the SBT (sets revoked flag)
      console.log('[handleRemoveMember] Step 1: Revoking SBT...');
      const revokeTx = await clients.membershipSbt.revoke({
        dao_id: BigInt(daoId),
        member: address,
        admin: publicKey,
      });

      await revokeTx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
      console.log('[handleRemoveMember] SBT revoked');

      // Step 2: Remove member from Merkle tree (zeros their leaf)
      console.log('[handleRemoveMember] Step 2: Removing from Merkle tree...');
      const removeTx = await clients.membershipTree.remove_member({
        dao_id: BigInt(daoId),
        member: address,
        admin: publicKey,
      });

      await removeTx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
      console.log('[handleRemoveMember] Member removed from tree');

      // Update local state
      const updatedMembers = members.filter(m => m.address !== address);
      const updatedRemoved = [...removedMembers, address];

      setMembers(updatedMembers);
      setRemovedMembers(updatedRemoved);
      setSuccess(`Successfully removed ${address.substring(0, 8)}... (SBT revoked + tree updated)`);

      // Reload tree info to show updated root
      await loadTreeInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
      console.error("Failed to remove member:", err);
    }
  };

  const handleLeave = async () => {
    if (!confirm(`Leave ${daoName}? You will no longer be able to vote in this DAO.`)) {
      return;
    }

    try {
      setLeaving(true);
      setError(null);
      setSuccess(null);

      const clients = initializeContractClients(publicKey);

      // Call the leave contract function
      const tx = await clients.membershipSbt.leave({
        dao_id: BigInt(daoId),
        member: publicKey,
      });

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      setSuccess(`You have left ${daoName}`);

      // Update local state
      const updatedMembers = members.filter(m => m.address !== publicKey);
      const updatedRemoved = [...removedMembers, publicKey];

      setMembers(updatedMembers);
      setRemovedMembers(updatedRemoved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave DAO");
      console.error("Failed to leave DAO:", err);
    } finally {
      setLeaving(false);
    }
  };

  const handleUpdateAlias = async (memberAddress: string) => {
    if (!isAdmin) {
      setError("Only admins can update aliases");
      return;
    }

    if (!newAlias.trim()) {
      setError("Alias cannot be empty");
      return;
    }

    try {
      setUpdatingAlias(true);
      setError(null);
      setSuccess(null);

      // Get or derive encryption key
      const key = await getOrDeriveEncryptionKey(daoId, signMessage);
      if (!key) {
        setError("Failed to derive encryption key");
        setUpdatingAlias(false);
        return;
      }

      // Encrypt the new alias
      const encryptedAlias = encryptAlias(newAlias, key);

      const clients = initializeContractClients(publicKey);

      // Call the update_alias contract function
      const tx = await clients.membershipSbt.update_alias({
        dao_id: BigInt(daoId),
        member: memberAddress,
        admin: publicKey,
        new_encrypted_alias: encryptedAlias,
      });

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      setSuccess(`Successfully updated alias for ${memberAddress.substring(0, 8)}...`);

      // Update local alias display
      const updatedAliases = new Map(memberAliases);
      updatedAliases.set(memberAddress, newAlias);
      setMemberAliases(updatedAliases);
      setEncryptionKey(key);

      // Clear editing state
      setEditingAlias(null);
      setNewAlias("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alias");
      console.error("Failed to update alias:", err);
    } finally {
      setUpdatingAlias(false);
    }
  };

  if (loading && !treeInfo && members.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Members
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {daoName} (DAO #{daoId})
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
          Verifying key version: {treeInfo?.vkVersion ?? 'N/A'}
        </p>
      </div>

      {/* Statistics Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
            Merkle Tree Depth
          </h3>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {treeInfo?.depth || 0}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
            Registered Voters
          </h3>
          <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {treeInfo?.leafCount || 0}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Registered in Merkle tree
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
            Tree Capacity
          </h3>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {treeInfo?.depth ? Math.pow(2, treeInfo.depth).toLocaleString() : 0}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Maximum members
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
            Verifying Key Version
          </h3>
          <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {treeInfo?.vkVersion ?? 'N/A'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Proofs must match this version
          </p>
        </div>
      </div>

      {/* Merkle Root */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Current Merkle Root
        </h3>
        <p className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
          {treeInfo?.root || 'N/A'}
        </p>
      </div>

      {/* Current Members */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Current Members ({members.length})
          </h3>
          {isAdmin && encryptedAliases.size > 0 && (
            <button
              onClick={toggleAliasVisibility}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
            >
              {aliasesVisible ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                  Hide Aliases
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Reveal Aliases
                </>
              )}
            </button>
          )}
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No members yet. {isAdmin ? 'Mint an SBT to add members.' : ''}
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.address}
                className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="flex flex-col">
                      {editingAlias === member.address ? (
                        <input
                          type="text"
                          value={newAlias}
                          onChange={(e) => setNewAlias(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !updatingAlias) {
                              e.preventDefault();
                              handleUpdateAlias(member.address);
                            } else if (e.key === 'Escape') {
                              setEditingAlias(null);
                              setNewAlias("");
                            }
                          }}
                          placeholder="Enter new alias..."
                          className="text-sm font-medium px-2 py-1 border border-purple-300 dark:border-purple-600 rounded bg-white dark:bg-gray-800 text-purple-600 dark:text-purple-400"
                          autoFocus
                        />
                      ) : (
                        encryptedAliases.has(member.address) && (
                          <div className="min-h-[20px] transition-all duration-200">
                            {aliasesVisible ? (
                              memberAliases.has(member.address) && (
                                <p className="text-sm font-medium text-purple-600 dark:text-purple-400">
                                  {memberAliases.get(member.address)}
                                </p>
                              )
                            ) : (
                              <p className="text-sm font-medium text-gray-500 dark:text-gray-500 truncate max-w-xs">
                                {encryptedAliases.get(member.address)}
                              </p>
                            )}
                          </div>
                        )
                      )}
                      <p className="font-mono text-xs text-gray-600 dark:text-gray-400">
                        {member.address}
                      </p>
                    </div>
                    {member.isAdmin && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && memberAliases.has(member.address) && editingAlias !== member.address && (
                      <button
                        onClick={() => {
                          setEditingAlias(member.address);
                          setNewAlias(memberAliases.get(member.address) || "");
                        }}
                        className="p-1 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded transition-colors"
                        title="Edit alias"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                    {editingAlias === member.address && (
                      <>
                        <button
                          onClick={() => handleUpdateAlias(member.address)}
                          disabled={updatingAlias}
                          className="p-1 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
                          title="Save alias"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setEditingAlias(null);
                            setNewAlias("");
                          }}
                          disabled={updatingAlias}
                          className="p-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900/30 rounded transition-colors disabled:opacity-50"
                          title="Cancel"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    )}
                    {isAdmin && member.address !== publicKey && !member.isAdmin && editingAlias !== member.address && (
                      <button
                        onClick={() => handleRemoveMember(member.address)}
                        className="p-1 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                        title="Revoke membership"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    {!isAdmin && member.address === publicKey && (
                      <button
                        onClick={handleLeave}
                        disabled={leaving}
                        className="px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                        title="Leave DAO"
                      >
                        {leaving ? "Leaving..." : "Leave"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Removed Members */}
      {removedMembers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Removed Members ({removedMembers.length})
          </h3>
          <div className="space-y-2">
            {removedMembers.map((address) => (
              <div
                key={address}
                className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg"
              >
                <p className="font-mono text-sm text-gray-700 dark:text-gray-300">
                  {address}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-100 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-100 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Mint SBT Form - Admin Only */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Mint Membership SBT
          </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Grant membership by minting a soulbound token to a Stellar address. Members can then register for anonymous voting.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Recipient Address
            </label>
            <input
              type="text"
              value={mintAddress}
              onChange={(e) => setMintAddress(e.target.value)}
              placeholder="G... (Stellar address)"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Member Alias (Optional)
              </label>
              <button
                onClick={toggleAliasInput}
                type="button"
                className="p-1.5 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                title={aliasInputUnlocked ? "Lock alias input" : "Unlock alias input"}
              >
                {aliasInputUnlocked ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="w-4 h-4">
                    <rect width="12" height="8.571" x="6" y="12.071" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" rx="2"/>
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.286 8.643a4.286 4.286 0 0 0-8.572 0v3.428"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="w-4 h-4">
                    <rect width="12.526" height="8.947" x="5.737" y="12.053" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" rx="2"/>
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7.526 12.053v-3.58a4.474 4.474 0 0 1 8.948 0v3.58"/>
                  </svg>
                )}
              </button>
            </div>
            <input
              type="text"
              value={memberAlias}
              onChange={(e) => setMemberAlias(e.target.value)}
              disabled={!aliasInputUnlocked}
              placeholder="e.g., Alice, Bob, Team Lead..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {aliasInputUnlocked
                ? "Encrypted and stored on-chain. Only you can decrypt it."
                : "Click the lock icon to unlock and add an alias."}
            </p>
          </div>

          <button
            onClick={handleMintSBT}
            disabled={minting || !mintAddress.trim()}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            {minting ? "Minting..." : "Mint SBT"}
          </button>
        </div>
        </div>
      )}

      {/* Info Note */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
          How Membership Works
        </h3>
        <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
          <li className="flex items-start">
            <span className="mr-2">1.</span>
            <span><strong>Mint SBT:</strong> Admin grants membership by minting a soulbound (non-transferable) token to a member's address</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2">2.</span>
            <span><strong>Register for Voting:</strong> Member registers a secret commitment in the Merkle tree to enable anonymous voting</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2">3.</span>
            <span><strong>Vote Anonymously:</strong> Member can now vote on proposals using ZK proofs without revealing their identity</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
