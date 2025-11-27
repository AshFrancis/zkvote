// Deployed contract addresses and network configuration
// Stellar Hosted Futurenet - Deployed 2025-11-27

export const CONTRACTS = {
  REGISTRY_ID: "CBYFVOBO7XPNHJGIX7YZBFZ2IFWJZEYQESPEQ7LQVQAYAZYOEFHRLO6R",
  SBT_ID: "CBHOLY46RUFIL56EWK5HP7XG6W5AIKXCWS5KTF6G5F3OJ4TRJGXTXTNO",
  TREE_ID: "CAE42F26ELFFLHE2QW657BTJPF7SKVJ5CSVQBE4DC5U6O36CLSOF7KXF",
  VOTING_ID: "CDPESUHCS2J3SQQ5HWJXJYXENJ4UUOJYD52MRKRIQJXI6LBLKQUCX2YE",
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
