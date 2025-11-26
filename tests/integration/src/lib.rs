#![no_std]

// Integration test crate - all code is test-only

#[cfg(test)]
mod tests {
    extern crate std;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String, Vec, U256};

    // Import actual contract clients
    use dao_registry::DaoRegistryClient;
    use membership_sbt::MembershipSbtClient;
    use membership_tree::MembershipTreeClient;
    use voting::{Proof, VerificationKey, VoteMode, VotingClient};

    /// Helper to setup the full DaoVote system
    struct DaoVoteSystem {
        env: Env,
        registry: Address,
        sbt: Address,
        tree: Address,
        voting: Address,
    }

    impl DaoVoteSystem {
        fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();

            // Register all contracts with CAP-0058 constructors
            let registry = env.register(dao_registry::DaoRegistry, ());
            let sbt = env.register(membership_sbt::MembershipSbt, (registry.clone(),));
            let tree = env.register(membership_tree::MembershipTree, (sbt.clone(),));
            let voting = env.register(voting::Voting, (tree.clone(),));

            Self {
                env,
                registry,
                sbt,
                tree,
                voting,
            }
        }

        fn registry_client(&self) -> DaoRegistryClient {
            DaoRegistryClient::new(&self.env, &self.registry)
        }

        fn sbt_client(&self) -> MembershipSbtClient {
            MembershipSbtClient::new(&self.env, &self.sbt)
        }

        fn tree_client(&self) -> MembershipTreeClient {
            MembershipTreeClient::new(&self.env, &self.tree)
        }

        fn voting_client(&self) -> VotingClient {
            VotingClient::new(&self.env, &self.voting)
        }

        fn create_test_vk(&self) -> VerificationKey {
            // Use valid BN254 curve points for testing
            // G1 generator point: (1, 2) in big-endian
            let g1_gen = self.bn254_g1_generator();
            // G2 generator point (simplified - actual G2 gen is more complex)
            let g2_gen = self.bn254_g2_generator();

            VerificationKey {
                alpha: g1_gen.clone(),
                beta: g2_gen.clone(),
                gamma: g2_gen.clone(),
                delta: g2_gen.clone(),
                // IC vector: IC[0] + one for each public signal
                // Public signals: [root, nullifier, daoId, proposalId, voteChoice, commitment] = 6 signals
                // So IC needs 7 elements
                ic: Vec::from_array(
                    &self.env,
                    [
                        g1_gen.clone(), // IC[0] base
                        g1_gen.clone(), // IC[1] for root
                        g1_gen.clone(), // IC[2] for nullifier
                        g1_gen.clone(), // IC[3] for daoId
                        g1_gen.clone(), // IC[4] for proposalId
                        g1_gen.clone(), // IC[5] for voteChoice
                        g1_gen.clone(), // IC[6] for commitment
                    ],
                ),
            }
        }

        fn create_test_proof(&self) -> Proof {
            let g1_gen = self.bn254_g1_generator();
            let g2_gen = self.bn254_g2_generator();

            Proof {
                a: g1_gen.clone(),
                b: g2_gen,
                c: g1_gen,
            }
        }

        // BN254 G1 generator: (1, 2)
        fn bn254_g1_generator(&self) -> BytesN<64> {
            let mut bytes = [0u8; 64];
            // x = 1 (big-endian, 32 bytes)
            bytes[31] = 1;
            // y = 2 (big-endian, 32 bytes)
            bytes[63] = 2;
            BytesN::from_array(&self.env, &bytes)
        }

        // BN254 G2 generator (first coordinate pair)
        fn bn254_g2_generator(&self) -> BytesN<128> {
            // G2 generator for BN254 (simplified representation)
            // x = (x1, x2), y = (y1, y2) where:
            // x1 = 10857046999023057135944570762232829481370756359578518086990519993285655852781
            // x2 = 11559732032986387107991004021392285783925812861821192530917403151452391805634
            // y1 = 8495653923123431417604973247489272438418190587263600148770280649306958101930
            // y2 = 4082367875863433681332203403145435568316851327593401208105741076214120093531
            let bytes: [u8; 128] = [
                // x1 (32 bytes)
                0x18, 0x00, 0x50, 0x6a, 0x06, 0x12, 0x86, 0xeb, 0x6a, 0x84, 0xa5, 0x73, 0x0b, 0x8f,
                0x10, 0x29, 0x3e, 0x29, 0x81, 0x6c, 0xd1, 0x91, 0x3d, 0x53, 0x38, 0xf7, 0x15, 0xde,
                0x3e, 0x98, 0xf9, 0xad, // x2 (32 bytes)
                0x19, 0x83, 0x90, 0x42, 0x11, 0xa5, 0x3f, 0x6e, 0x0b, 0x08, 0x53, 0xa9, 0x0a, 0x00,
                0xef, 0xbf, 0xf1, 0x70, 0x0c, 0x7b, 0x1d, 0xc0, 0x06, 0x32, 0x4d, 0x85, 0x9d, 0x75,
                0xe3, 0xca, 0xa5, 0xa2, // y1 (32 bytes)
                0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x8e, 0x80, 0x6a,
                0x51, 0xa5, 0x66, 0x08, 0x21, 0x4c, 0x3f, 0x62, 0x8b, 0x96, 0x2c, 0xf1, 0x91, 0xea,
                0xcd, 0xc8, 0x0e, 0x7a, // y2 (32 bytes)
                0x09, 0x0d, 0x97, 0xc0, 0x9c, 0xe1, 0x48, 0x60, 0x63, 0xb3, 0x59, 0xf3, 0xdd, 0x89,
                0xb7, 0xc4, 0x3c, 0x5f, 0x18, 0x95, 0x8f, 0xb3, 0xe6, 0xb9, 0x6d, 0xb5, 0x5e, 0x19,
                0xa3, 0xb7, 0xc0, 0xfb,
            ];
            BytesN::from_array(&self.env, &bytes)
        }
    }

    #[test]
    fn test_full_dao_creation_flow() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let dao_name = String::from_str(&system.env, "Test DAO");

        // Create DAO in registry
        let dao_id = system
            .registry_client()
            .create_dao(&dao_name, &admin, &false);
        assert_eq!(dao_id, 1);

        // Verify DAO exists and admin is correct
        let dao_info = system.registry_client().get_dao(&dao_id);
        assert_eq!(dao_info.admin, admin);
        assert_eq!(dao_info.name, dao_name);

        // Initialize tree for this DAO
        system.tree_client().init_tree(&dao_id, &5, &admin);
    }

    #[test]
    fn test_membership_flow() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let member = Address::generate(&system.env);

        // Create DAO
        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        // Admin mints SBT to member
        // This verifies admin through registry cross-contract call
        system.sbt_client().mint(&dao_id, &member, &admin, &None);

        // Verify membership
        assert!(system.sbt_client().has(&dao_id, &member));
        assert!(!system.sbt_client().has(&dao_id, &admin)); // Admin doesn't have SBT automatically
    }

    #[test]
    fn test_identity_commitment_registration() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let member = Address::generate(&system.env);

        // Create DAO
        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        // Initialize tree
        system.tree_client().init_tree(&dao_id, &5, &admin);

        // Mint SBT to member
        system.sbt_client().mint(&dao_id, &member, &admin, &None);

        // Member registers identity commitment
        // This verifies SBT ownership through cross-contract call
        let commitment = U256::from_u32(&system.env, 12345);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment, &member);

        // Get the new root (commitment is in tree if we got here without panic)
        let root = system.tree_client().current_root(&dao_id);
        assert!(system.tree_client().root_ok(&dao_id, &root));
    }

    #[test]
    fn test_proposal_creation() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let member = Address::generate(&system.env);

        // Setup DAO
        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        // Initialize tree (required for proposal creation to snapshot root)
        system.tree_client().init_tree(&dao_id, &5, &admin);

        // Member needs SBT to create proposal
        system.sbt_client().mint(&dao_id, &member, &admin, &None);

        // Create verification key for proposals
        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        // Member creates proposal
        let description = String::from_str(&system.env, "Increase funding");
        let now = system.env.ledger().timestamp();
        let end_time = now + 86400; // 1 day

        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &description,
            &end_time,
            &member,
            &VoteMode::Fixed,
        );

        assert_eq!(proposal_id, 1);

        // Verify proposal exists
        let proposal = system.voting_client().get_proposal(&dao_id, &proposal_id);
        assert_eq!(proposal.description, description);
        assert_eq!(proposal.yes_votes, 0);
        assert_eq!(proposal.no_votes, 0);
    }

    #[test]
    fn test_full_voting_flow() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let member1 = Address::generate(&system.env);
        let member2 = Address::generate(&system.env);

        // 1. Create DAO
        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Voting DAO"),
            &admin,
            &false,
        );

        // 2. Initialize tree
        system.tree_client().init_tree(&dao_id, &5, &admin);

        // 3. Mint SBTs to members
        system.sbt_client().mint(&dao_id, &member1, &admin, &None);
        system.sbt_client().mint(&dao_id, &member2, &admin, &None);

        // 4. Members register identity commitments
        let commitment1 = U256::from_u32(&system.env, 11111);
        let commitment2 = U256::from_u32(&system.env, 22222);

        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment1, &member1);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment2, &member2);

        // 5. Get current root for voting
        let root = system.tree_client().current_root(&dao_id);

        // 6. Set up voting contract
        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        // 7. Create proposal (member1 creates it)
        let description = String::from_str(&system.env, "Fund development");
        let now = system.env.ledger().timestamp();
        let end_time = now + 86400;

        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &description,
            &end_time,
            &member1,
            &VoteMode::Fixed,
        );

        // 8. Cast anonymous votes
        let proof = system.create_test_proof();

        // Member 1 votes FOR
        let nullifier1 = U256::from_u32(&system.env, 99999);
        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true, // FOR
            &nullifier1,
            &root,
            &commitment1, // NEW: commitment for revocation checks
            &proof,
        );

        // Member 2 votes AGAINST
        let nullifier2 = U256::from_u32(&system.env, 88888);
        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &false, // AGAINST
            &nullifier2,
            &root,
            &commitment2, // NEW: commitment for revocation checks
            &proof,
        );

        // 9. Verify vote counts
        let proposal = system.voting_client().get_proposal(&dao_id, &proposal_id);
        assert_eq!(proposal.yes_votes, 1);
        assert_eq!(proposal.no_votes, 1);
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn test_non_admin_cannot_mint_sbt() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let non_admin = Address::generate(&system.env);
        let member = Address::generate(&system.env);

        // Create DAO with specific admin
        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        // Non-admin tries to mint SBT - should fail
        system
            .sbt_client()
            .mint(&dao_id, &member, &non_admin, &None);
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn test_non_member_cannot_register_commitment() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let non_member = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        system.tree_client().init_tree(&dao_id, &5, &admin);

        // Non-member (no SBT) tries to register commitment
        let commitment = U256::from_u32(&system.env, 12345);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment, &non_member);
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn test_non_member_cannot_create_proposal() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let non_member = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        // Non-member tries to create proposal
        let description = String::from_str(&system.env, "Bad proposal");
        let now = system.env.ledger().timestamp();
        let end_time = now + 86400;

        system.voting_client().create_proposal(
            &dao_id,
            &description,
            &end_time,
            &non_member,
            &VoteMode::Fixed,
        );
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn test_double_voting_prevented() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let member = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        system.tree_client().init_tree(&dao_id, &5, &admin);
        system.sbt_client().mint(&dao_id, &member, &admin, &None);

        let commitment = U256::from_u32(&system.env, 12345);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment, &member);

        let root = system.tree_client().current_root(&dao_id);

        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        let description = String::from_str(&system.env, "Test");
        let now = system.env.ledger().timestamp();
        let end_time = now + 86400;
        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &description,
            &end_time,
            &member,
            &VoteMode::Fixed,
        );

        let proof = system.create_test_proof();
        let nullifier = U256::from_u32(&system.env, 99999);

        // First vote succeeds
        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true,
            &nullifier,
            &root,
            &commitment, // NEW: commitment for revocation checks
            &proof,
        );

        // Second vote with same nullifier fails
        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &false, // Different choice, same nullifier
            &nullifier,
            &root,
            &commitment, // NEW: commitment for revocation checks
            &proof,
        );
    }

    #[test]
    fn test_multiple_daos_isolated() {
        let system = DaoVoteSystem::new();

        let admin1 = Address::generate(&system.env);
        let admin2 = Address::generate(&system.env);
        let member1 = Address::generate(&system.env);
        let member2 = Address::generate(&system.env);

        // Create two separate DAOs
        let dao1 = system.registry_client().create_dao(
            &String::from_str(&system.env, "DAO 1"),
            &admin1,
            &false,
        );
        let dao2 = system.registry_client().create_dao(
            &String::from_str(&system.env, "DAO 2"),
            &admin2,
            &false,
        );

        // Initialize trees
        system.tree_client().init_tree(&dao1, &5, &admin1);
        system.tree_client().init_tree(&dao2, &5, &admin2);

        // Mint SBTs (each admin to their own DAO)
        system.sbt_client().mint(&dao1, &member1, &admin1, &None);
        system.sbt_client().mint(&dao2, &member2, &admin2, &None);

        // Verify isolation
        assert!(system.sbt_client().has(&dao1, &member1));
        assert!(!system.sbt_client().has(&dao1, &member2));
        assert!(!system.sbt_client().has(&dao2, &member1));
        assert!(system.sbt_client().has(&dao2, &member2));

        // Register commitments
        let commitment1 = U256::from_u32(&system.env, 11111);
        let commitment2 = U256::from_u32(&system.env, 22222);

        system
            .tree_client()
            .register_with_caller(&dao1, &commitment1, &member1);
        system
            .tree_client()
            .register_with_caller(&dao2, &commitment2, &member2);

        // Commitments registered successfully (would panic if failed)
        // Verify isolation via separate roots

        // Roots are different
        let root1 = system.tree_client().current_root(&dao1);
        let root2 = system.tree_client().current_root(&dao2);
        assert!(root1 != root2);
    }

    #[test]
    fn test_admin_transfer_affects_minting() {
        let system = DaoVoteSystem::new();

        let admin1 = Address::generate(&system.env);
        let admin2 = Address::generate(&system.env);
        let member = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin1,
            &false,
        );

        // Transfer admin rights
        system.registry_client().transfer_admin(&dao_id, &admin2);

        // Old admin can no longer mint
        // New admin can mint
        system.sbt_client().mint(&dao_id, &member, &admin2, &None);
        assert!(system.sbt_client().has(&dao_id, &member));
    }

    #[test]
    fn test_root_history_for_late_voters() {
        let system = DaoVoteSystem::new();

        let admin = Address::generate(&system.env);
        let member1 = Address::generate(&system.env);
        let member2 = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        system.tree_client().init_tree(&dao_id, &5, &admin);
        system.sbt_client().mint(&dao_id, &member1, &admin, &None);
        system.sbt_client().mint(&dao_id, &member2, &admin, &None);

        // Only Member 1 registers before proposal creation
        let commitment1 = U256::from_u32(&system.env, 11111);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment1, &member1);

        // Set up voting
        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        let description = String::from_str(&system.env, "Test");
        let now = system.env.ledger().timestamp();
        let end_time = now + 86400;
        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &description,
            &end_time,
            &member1,
            &VoteMode::Fixed,
        );

        // Get proposal's eligible root (snapshotted at creation)
        let proposal = system.voting_client().get_proposal(&dao_id, &proposal_id);
        let eligible_root = proposal.eligible_root;

        // Member 2 registers AFTER proposal creation (changes tree root)
        let commitment2 = U256::from_u32(&system.env, 22222);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment2, &member2);

        let new_root = system.tree_client().current_root(&dao_id);

        // Verify roots are different
        assert_ne!(eligible_root, new_root);

        // Member 1 CAN vote with the eligible root (they were in tree at proposal creation)
        let proof = system.create_test_proof();
        let nullifier1 = U256::from_u32(&system.env, 99999);

        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true,
            &nullifier1,
            &eligible_root,
            &commitment1, // NEW: commitment for revocation checks
            &proof,
        );

        let updated_proposal = system.voting_client().get_proposal(&dao_id, &proposal_id);
        assert_eq!(updated_proposal.yes_votes, 1);

        // Member 2 CANNOT vote with new root (must match eligible_root)
        // This test would panic with "root must match proposal eligible root"
        // We just verify they can't use the current root
        assert_ne!(eligible_root, new_root); // Their proof would use new_root, which won't match
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn test_new_member_cannot_vote_on_old_proposal() {
        let system = DaoVoteSystem::new();
        let admin = Address::generate(&system.env);
        let member1 = Address::generate(&system.env);
        let member2 = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        system.tree_client().init_tree(&dao_id, &5, &admin);
        system.sbt_client().mint(&dao_id, &member1, &admin, &None);
        system.sbt_client().mint(&dao_id, &member2, &admin, &None);

        // Only Member 1 registers before proposal
        let commitment1 = U256::from_u32(&system.env, 11111);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment1, &member1);

        // Set up voting and create proposal
        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        let now = system.env.ledger().timestamp();
        let end_time = now + 86400;
        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &String::from_str(&system.env, "Test"),
            &end_time,
            &member1,
            &VoteMode::Fixed,
        );

        // Member 2 registers AFTER proposal creation
        let commitment2 = U256::from_u32(&system.env, 22222);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment2, &member2);

        // Member 2 tries to vote with current (new) root - should fail
        let new_root = system.tree_client().current_root(&dao_id);
        let proof = system.create_test_proof();
        let nullifier = U256::from_u32(&system.env, 88888);

        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true,
            &nullifier,
            &new_root,    // This won't match eligible_root
            &commitment2, // NEW: commitment for revocation checks
            &proof,
        );
    }

    // ========================================
    // Trailing Mode Tests (Native Contracts)
    // ========================================

    #[test]
    fn test_trailing_mode_late_joiner_can_vote() {
        let system = DaoVoteSystem::new();
        let admin = Address::generate(&system.env);
        let member1 = Address::generate(&system.env);
        let member2 = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        system.tree_client().init_tree(&dao_id, &5, &admin);
        system.sbt_client().mint(&dao_id, &member1, &admin, &None);

        // Member 1 registers commitment
        let commitment1 = U256::from_u32(&system.env, 11111);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment1, &member1);

        // Set up voting
        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        // Create proposal in TRAILING mode
        let now = system.env.ledger().timestamp();
        let end_time = now + 86400;
        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &String::from_str(&system.env, "Trailing Mode Test"),
            &end_time,
            &member1,
            &VoteMode::Trailing, // Trailing mode allows late joiners
        );

        // Member 2 joins AFTER proposal creation
        system.sbt_client().mint(&dao_id, &member2, &admin, &None);
        let commitment2 = U256::from_u32(&system.env, 22222);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment2, &member2);

        // Get the NEW root (includes member2)
        let new_root = system.tree_client().current_root(&dao_id);

        // Member 2 CAN vote with new root in trailing mode
        let proof = system.create_test_proof();
        let nullifier = U256::from_u32(&system.env, 88888);

        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true,
            &nullifier,
            &new_root, // New root is valid in trailing mode
            &commitment2,
            &proof,
        );

        // Verify vote was counted
        let proposal = system.voting_client().get_proposal(&dao_id, &proposal_id);
        assert_eq!(proposal.yes_votes, 1);
    }

    #[test]
    #[should_panic(expected = "HostError")]
    fn test_trailing_mode_revoked_member_cannot_vote() {
        let system = DaoVoteSystem::new();
        let admin = Address::generate(&system.env);
        let member1 = Address::generate(&system.env);
        let member2 = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        system.tree_client().init_tree(&dao_id, &5, &admin);
        system.sbt_client().mint(&dao_id, &member1, &admin, &None);
        system.sbt_client().mint(&dao_id, &member2, &admin, &None);

        // Member 1 registers commitment
        let commitment1 = U256::from_u32(&system.env, 11111);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment1, &member1);

        // Capture the old root
        let old_root = system.tree_client().current_root(&dao_id);

        // Remove member1 (revokes their commitment)
        system
            .tree_client()
            .remove_member(&dao_id, &member1, &admin);

        // Member 2 registers
        let commitment2 = U256::from_u32(&system.env, 22222);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment2, &member2);

        // Set up voting
        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        // Create proposal AFTER member1 revocation
        let now = system.env.ledger().timestamp();
        let end_time = now + 86400;
        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &String::from_str(&system.env, "New Proposal"),
            &end_time,
            &member2,
            &VoteMode::Trailing,
        );

        // Revoked member1 tries to vote - should fail due to revocation check
        let proof = system.create_test_proof();
        let nullifier = U256::from_u32(&system.env, 99999);

        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true,
            &nullifier,
            &old_root,
            &commitment1, // This commitment was revoked
            &proof,
        );
    }

    // NOTE: The current voting contract has strict revocation checks that prevent
    // members from voting once revoked, even on proposals created before revocation.
    // This test documents that behavior - it could be changed in the future.
    #[test]
    #[should_panic(expected = "HostError")]
    fn test_trailing_mode_removed_member_cannot_vote_even_on_old_proposal() {
        use soroban_sdk::testutils::Ledger;

        let system = DaoVoteSystem::new();
        let admin = Address::generate(&system.env);
        let member1 = Address::generate(&system.env);

        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Test DAO"),
            &admin,
            &false,
        );

        system.tree_client().init_tree(&dao_id, &5, &admin);
        system.sbt_client().mint(&dao_id, &member1, &admin, &None);

        // Member 1 registers commitment at timestamp 100
        system.env.ledger().with_mut(|li| li.timestamp = 100);
        let commitment1 = U256::from_u32(&system.env, 11111);
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment1, &member1);

        // Capture root before removal
        let member_root = system.tree_client().current_root(&dao_id);

        // Set up voting
        let vk = system.create_test_vk();
        system.voting_client().set_vk(&dao_id, &vk, &admin);

        // Create proposal at timestamp 200 (BEFORE removal) in TRAILING mode
        system.env.ledger().with_mut(|li| li.timestamp = 200);
        let end_time = 200 + 86400;
        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &String::from_str(&system.env, "Old Proposal"),
            &end_time,
            &member1,
            &VoteMode::Trailing,
        );

        // Remove member1 at timestamp 300 (AFTER proposal creation)
        system.env.ledger().with_mut(|li| li.timestamp = 300);
        system
            .tree_client()
            .remove_member(&dao_id, &member1, &admin);

        // Vote at timestamp 400 (during voting period)
        system.env.ledger().with_mut(|li| li.timestamp = 400);

        // With current contract logic, even though the member was active when proposal
        // was created, they cannot vote after being revoked (would need reinstatement)
        let proof = system.create_test_proof();
        let nullifier = U256::from_u32(&system.env, 77777);

        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true,
            &nullifier,
            &member_root,
            &commitment1, // This commitment was revoked at ts 300
            &proof,
        );
    }

    #[test]
    fn budget_baseline_create_proposal_and_vote() {
        let system = DaoVoteSystem::new();
        // Use a finite budget to get measurements
        system.env.cost_estimate().budget().reset_default();

        let admin = Address::generate(&system.env);
        let member = Address::generate(&system.env);

        // --- create_dao ---
        let cpu_before = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = system.env.cost_estimate().budget().memory_bytes_cost();
        let dao_id = system.registry_client().create_dao(
            &String::from_str(&system.env, "Budget DAO"),
            &admin,
            &true,
        );
        let cpu_after = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = system.env.cost_estimate().budget().memory_bytes_cost();
        let cpu_delta = cpu_after.saturating_sub(cpu_before);
        let mem_delta = mem_after.saturating_sub(mem_before);
        std::println!("[budget] create_dao cpu={} mem={}", cpu_delta, mem_delta);
        assert!(cpu_delta <= 80_000, "create_dao cpu too high");
        assert!(mem_delta <= 20_000, "create_dao mem too high");

        // Initialize tree and mint SBT
        system.tree_client().init_tree(&dao_id, &5, &admin);
        system.sbt_client().mint(&dao_id, &member, &admin, &None);

        // --- register commitment ---
        let commitment = U256::from_u32(&system.env, 42);
        let cpu_before = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = system.env.cost_estimate().budget().memory_bytes_cost();
        system
            .tree_client()
            .register_with_caller(&dao_id, &commitment, &member);
        let cpu_after = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = system.env.cost_estimate().budget().memory_bytes_cost();
        let cpu_delta = cpu_after.saturating_sub(cpu_before);
        let mem_delta = mem_after.saturating_sub(mem_before);
        std::println!(
            "[budget] register_with_caller cpu={} mem={}",
            cpu_delta,
            mem_delta
        );
        assert!(cpu_delta <= 10_000_000, "register_with_caller cpu too high");
        assert!(mem_delta <= 600_000, "register_with_caller mem too high");

        // --- set_vk ---
        let vk = system.create_test_vk();
        let cpu_before = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = system.env.cost_estimate().budget().memory_bytes_cost();
        system.voting_client().set_vk(&dao_id, &vk, &admin);
        let cpu_after = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = system.env.cost_estimate().budget().memory_bytes_cost();
        let cpu_delta = cpu_after.saturating_sub(cpu_before);
        let mem_delta = mem_after.saturating_sub(mem_before);
        std::println!("[budget] set_vk cpu={} mem={}", cpu_delta, mem_delta);
        assert!(cpu_delta <= 200_000, "set_vk cpu too high");
        assert!(mem_delta <= 100_000, "set_vk mem too high");

        // --- create_proposal ---
        let cpu_before = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = system.env.cost_estimate().budget().memory_bytes_cost();
        let proposal_id = system.voting_client().create_proposal(
            &dao_id,
            &String::from_str(&system.env, "Proposal A"),
            &0, // no deadline
            &admin,
            &VoteMode::Fixed,
        );
        let cpu_after = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = system.env.cost_estimate().budget().memory_bytes_cost();
        let cpu_delta = cpu_after.saturating_sub(cpu_before);
        let mem_delta = mem_after.saturating_sub(mem_before);
        std::println!(
            "[budget] create_proposal cpu={} mem={}",
            cpu_delta,
            mem_delta
        );
        assert!(cpu_delta <= 400_000, "create_proposal cpu too high");
        assert!(mem_delta <= 100_000, "create_proposal mem too high");

        // --- vote ---
        let root = system.tree_client().get_root(&dao_id);
        let proof = system.create_test_proof();
        let nullifier = U256::from_u32(&system.env, 7);

        let cpu_before = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = system.env.cost_estimate().budget().memory_bytes_cost();
        system.voting_client().vote(
            &dao_id,
            &proposal_id,
            &true,
            &nullifier,
            &root,
            &commitment,
            &proof,
        );
        let cpu_after = system.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = system.env.cost_estimate().budget().memory_bytes_cost();
        let cpu_delta = cpu_after.saturating_sub(cpu_before);
        let mem_delta = mem_after.saturating_sub(mem_before);
        std::println!("[budget] vote cpu={} mem={}", cpu_delta, mem_delta);
        assert!(cpu_delta <= 500_000, "vote cpu too high (test mode)");
        assert!(mem_delta <= 120_000, "vote mem too high (test mode)");
    }
}
