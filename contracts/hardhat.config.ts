import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "dotenv/config";

import type { HardhatUserConfig } from "hardhat/config";

const sepoliaAccounts = (process.env.KEEPER_PRIVATE_KEY?.trim() || process.env.SEPOLIA_PRIVATE_KEYS || process.env.PRIVATE_KEY || "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
    },
  },
  namedAccounts: { deployer: 0 },
  networks: {
    hardhat: {},
    anvil: { url: "http://127.0.0.1:8545" },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL ?? "",
      accounts: sepoliaAccounts,
    },
  },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "" },
  typechain: { outDir: "typechain-types", target: "ethers-v6" },
  gasReporter: { enabled: process.env.REPORT_GAS === "true", currency: "USD" },
};

export default config;
