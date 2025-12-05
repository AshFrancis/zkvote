// Deployed contract addresses and network configuration

// Deploy version for cache invalidation (increment on each deployment)
export const DEPLOY_VERSION = "v1.0.0-futurenet";

export const CONTRACTS = {
  REGISTRY_ID: "CCPU3L56OKF73DY2UCADZG7MG7CTBP52N5K4BYXOY5MWV3FJ6OBPK2BY",
  SBT_ID: "CB2X7TBDIF5OXX4Z2LESL2MX3FZ5GSPEBPUYGBOI3VREJWI6X7FGP7NU",
  TREE_ID: "CDZFVEBB57T3GIMEEN5JITCNF25WF2KQZBTUBTXZDPOANKAP7Z4X5UDB",
  VOTING_ID: "CAEQUA6WXDCKKSO3DN57RL6KXHIWREWPCFD3CLUXSQN653YRZEKIWKG4",
  COMMENTS_ID: "CCJU5L3UFRRNXKOAQXNJ2SOQD5ZID3U4F4HAPF6RIC3KUE5FZG5APMH3",
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
