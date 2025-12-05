// Deployed contract addresses and network configuration
// Auto-generated on Thu  4 Dec 2025 12:30:00 GMT

export const CONTRACTS = {
  REGISTRY_ID: "CCYTYDVBHCPSNJDS6VOJUTPBF2ZUDXOHCTHFL4OGURPFRKZQ37MJKEN4",
  SBT_ID: "CAK4T2LJSTGR563576GOYHOMZ473NOLHQCTOVT4O7VF54ZXJA4S3LOIO",
  TREE_ID: "CAEPUV2YZXNMAHQRJ4GRCGOECVCVL7ZAVKL4DUJT67INSUWZ26OM55Q2",
  VOTING_ID: "CBLX7MHAUZCPLM6HBMDI34E4VKN2KPU6OVZIWYHGMMR2FL5QFM7MJQDG",
  COMMENTS_ID: "CDZOATGZTEKFWDKY2FJ4DH7O6MSWP4FFFQRS4FEQQ3CVWR6MZH5T3RCQ",
} as const;

export const NETWORK_CONFIG = {
  rpcUrl: "https://rpc-futurenet.stellar.org",
  networkPassphrase: "Test SDF Future Network ; October 2022",
  networkName: "futurenet",
} as const;

// Deployment version - changes on each deployment
// Used for cache invalidation in frontend
export const DEPLOY_VERSION = "1733318400";

// Contract method names for type safety
export const CONTRACT_METHODS = {
  REGISTRY: {
    CREATE_DAO: "create_dao",
    GET_DAO: "get_dao",
    CREATE_AND_INIT_DAO: "create_and_init_dao",
    CREATE_AND_INIT_DAO_NO_REG: "create_and_init_dao_no_reg",
  },
  SBT: {
    MINT: "mint",
    MINT_FROM_REGISTRY: "mint_from_registry",
    HAS: "has",
  },
  TREE: {
    INIT_TREE: "init_tree",
    REGISTER_WITH_CALLER: "register_with_caller",
    GET_ROOT: "get_root",
  },
  VOTING: {
    SET_VK: "set_vk",
    CREATE_PROPOSAL: "create_proposal",
    VOTE: "vote",
    GET_PROPOSAL: "get_proposal",
    GET_RESULTS: "get_results",
  },
} as const;
