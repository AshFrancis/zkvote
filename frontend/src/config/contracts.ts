// Deployed contract addresses and network configuration
// Stellar Hosted Futurenet - Deployed 2025-11-27

export const CONTRACTS = {
  REGISTRY_ID: "CB4HIZMHYLHNLVHXYNPSRQHOZALOAUX3JQN4GMDOHIWE4H3QPUUCBV7O",
  SBT_ID: "CBYFTZ7TM37Q3G4S2FUAV55RP2EKVE7JNKBFHCSV4MKPMPIHQVX2VTDW",
  TREE_ID: "CDF3FRS4733EDQQTC2RFPMTCUA3M74WRL2XTUII3ZMXIQELI5XPQZPY2",
  VOTING_ID: "CCVQB4JRHQNKWULWLFK43T5EO5SAUS3THKLX63OHD2APEJQB4ZYL5EPF",
} as const;

export const NETWORK_CONFIG = {
  rpcUrl: "https://rpc-futurenet.stellar.org:443",
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
