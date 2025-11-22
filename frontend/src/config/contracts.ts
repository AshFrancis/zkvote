// Deployed contract addresses and network configuration
// Last deployed: Manual deployment on Thu 21 Nov 2025

export const CONTRACTS = {
  REGISTRY_ID: "CBBGVASVRSTEYWMQDIR3EA5BSPMLVP22RCO5YXMTIGH3RXSDGFEM43MN",
  SBT_ID: "CBZ5PXB4ECFRXBBUSB5IXR4UPK2K4YMNVLRSGUWY6BAQRB64GAZTBADE",
  TREE_ID: "CBLPIUKZ4BXKAYBT36WITUWLOF2UV6RSSJ6FGX4YNTRD57BN73H4E6ZA",
  VOTING_ID: "CBALQUWRMIS7PUDQJSYPJVX5L2HYVZY4D5GE77FCMHJJMK5P5FNB7UJB",
} as const;

export const NETWORK_CONFIG = {
  rpcUrl: "http://localhost:8000/soroban/rpc",
  networkPassphrase: "Test SDF Future Network ; October 2022",
  networkName: "futurenet-local",
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
