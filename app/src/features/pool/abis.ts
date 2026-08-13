export const wrappersRegistryAbi = [{
  type: "function", name: "getTokenConfidentialTokenPairs", stateMutability: "view", inputs: [],
  outputs: [{ type: "tuple[]", name: "", components: [
    { type: "address", name: "tokenAddress" }, { type: "address", name: "confidentialTokenAddress" }, { type: "bool", name: "isValid" },
  ] }],
}] as const;

export const poolFactoryAbi = [{
  type: "function", name: "poolByAsset", stateMutability: "view",
  inputs: [{ type: "address", name: "confidentialToken" }], outputs: [{ type: "address", name: "pool" }],
}] as const;

export const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string", name: "" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8", name: "" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "uint256", name: "" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }], outputs: [{ type: "uint256", name: "" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool", name: "" }] },
] as const;

export const confidentialWrapperAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string", name: "" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8", name: "" }] },
  { type: "function", name: "rate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256", name: "" }] },
  { type: "function", name: "confidentialBalanceOf", stateMutability: "view", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "bytes32", name: "" }] },
] as const;

export const poolAbi = [
  { type: "event", name: "EncryptedDeposit", inputs: [{ indexed: true, name: "participant", type: "address" }, { indexed: true, name: "encryptedAmount", type: "bytes32" }] },
  { type: "event", name: "EncryptedWithdrawal", inputs: [{ indexed: true, name: "participant", type: "address" }, { indexed: true, name: "encryptedAmount", type: "bytes32" }] },
  { type: "event", name: "EncryptedPrizeClaimed", inputs: [{ indexed: true, name: "participant", type: "address" }, { indexed: true, name: "encryptedAmount", type: "bytes32" }] },
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8", name: "" }] },
  { type: "function", name: "nextDrawAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64", name: "" }] },
  { type: "function", name: "drawId", stateMutability: "view", inputs: [], outputs: [{ type: "uint64", name: "" }] },
  { type: "function", name: "completedDraws", stateMutability: "view", inputs: [], outputs: [{ type: "uint64", name: "" }] },
  { type: "function", name: "participantCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256", name: "" }] },
  { type: "function", name: "selectionCursor", stateMutability: "view", inputs: [], outputs: [{ type: "uint16", name: "" }] },
  { type: "function", name: "syncCursor", stateMutability: "view", inputs: [], outputs: [{ type: "uint16", name: "" }] },
  { type: "function", name: "totalWeightHandle", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32", name: "" }] },
  { type: "function", name: "resultHandle", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32", name: "" }] },
  { type: "function", name: "encryptedPrincipalOf", stateMutability: "view", inputs: [{ type: "address", name: "participant" }], outputs: [{ type: "bytes32", name: "" }] },
  { type: "function", name: "encryptedWinningsOf", stateMutability: "view", inputs: [{ type: "address", name: "participant" }], outputs: [{ type: "bytes32", name: "" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ type: "bytes32", name: "encryptedAmount" }, { type: "bytes", name: "inputProof" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "bytes32", name: "encryptedAmount" }, { type: "bytes", name: "inputProof" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "requestDraw", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "startSelection", stateMutability: "nonpayable", inputs: [
    { type: "bytes32[]", name: "handlesList" }, { type: "bytes", name: "abiEncodedCleartexts" }, { type: "bytes", name: "decryptionProof" },
  ], outputs: [] },
  { type: "function", name: "processSelectionBatch", stateMutability: "nonpayable", inputs: [{ type: "uint16", name: "requestedBatchSize" }], outputs: [] },
  { type: "function", name: "finalizeSelection", stateMutability: "nonpayable", inputs: [
    { type: "bytes32[]", name: "handlesList" }, { type: "bytes", name: "abiEncodedCleartexts" }, { type: "bytes", name: "decryptionProof" },
  ], outputs: [] },
  { type: "function", name: "processNextDrawSyncBatch", stateMutability: "nonpayable", inputs: [{ type: "uint16", name: "requestedBatchSize" }], outputs: [] },
] as const;

export const faucetAbi = [
  { type: "function", name: "relayers", stateMutability: "view", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "bool", name: "enabled" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ type: "address", name: "tokenAddress" }], outputs: [] },
  { type: "function", name: "claimFor", stateMutability: "nonpayable", inputs: [{ type: "address", name: "account" }, { type: "address", name: "tokenAddress" }], outputs: [] },
  { type: "function", name: "getClaimStatus", stateMutability: "view", inputs: [{ type: "address", name: "tokenAddress" }, { type: "address", name: "account" }], outputs: [
    { type: "uint256", name: "claimAmount" }, { type: "bool", name: "enabled" }, { type: "uint256", name: "lastClaim" }, { type: "uint256", name: "nextClaimAt" }, { type: "bool", name: "canClaim" },
  ] },
] as const;
