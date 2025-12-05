// Deployed contract addresses and network configuration

// Deploy version for cache invalidation (increment on each deployment)
export const DEPLOY_VERSION = "v1.0.0-local";

export const CONTRACTS = {
  REGISTRY_ID: "CCZXSO3ODKLZ5NMDYXMP6Q265B5LJZLZX4DYNYMODNA47X2RXAROOOSI",
  SBT_ID: "CAOANMWX3T7UU77LNBVOVVM27Q3GM6RGUUCGKAAV62XODDA3BASBSRDP",
  TREE_ID: "CCRWUPUKDQO7S6L6CQ3QILG7IFKZDVBJXW7J7LNGYJBIW5YC4XBD5DYA",
  VOTING_ID: "CAPV7SOXUDPPCBUQOUQNVP3ZWCMKKG5MWLNDUYXTCY4Q2ZH7JSN3QE6D",
  COMMENTS_ID: "CBCHAMOK6CW5ULRJ6CNFEOZLPUBN6AFAFHCFPBTEO6KLAHV33R7G26QF",
} as const;

export const NETWORK_CONFIG = {
  rpcUrl: "https://rpc-futurenet.stellar.org",
  networkPassphrase: "Test SDF Future Network ; October 2022",
  networkName: "futurenet",
} as const;

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
