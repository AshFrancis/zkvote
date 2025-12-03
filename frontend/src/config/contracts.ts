// Deployed contract addresses and network configuration
// Auto-generated on Wed  3 Dec 2025 19:47:13 GMT

export const CONTRACTS = {
  REGISTRY_ID: "CBX2AHHDNWWCXODGEINVFDZZFP434SJCZK2WHVGHE3X7RMGDFOCAA2Y5",
  SBT_ID: "CBQNPPHWS35FGU5V6P2NWSXEMKIU3F4EJODMLMDBERB2FCRF2NCUV5HU",
  TREE_ID: "CDDOVPNV7YXSC3AU6KJ5WTSZABGJHKO2PJGN27VOL5TFYPMJGZVEYEWP",
  VOTING_ID: "CB2OXVQHV6TI5GTHVGTUQLIVME5KRUA4R5GJLIMPS5VH2JG5O3DB6LR5",
  COMMENTS_ID: "CB6I7XUCMSLTABOFAIVAUXYIJYS5SPJM6WZDTQV5S62QQ43AZMIJDIB7",
} as const;

export const NETWORK_CONFIG = {
  rpcUrl: "https://rpc-futurenet.stellar.org",
  networkPassphrase: "Test SDF Future Network ; October 2022",
  networkName: "futurenet",
} as const;

// Deployment version - changes on each deployment
// Used for cache invalidation in frontend
export const DEPLOY_VERSION = "1764791020";

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
