import { getAddress, isAddress, type Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11_155_111;

function environmentAddress(name: string, fallback: Address): Address {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (!isAddress(value)) throw new Error(`${name} is not a valid address.`);
  return getAddress(value);
}

export const WRAPPERS_REGISTRY_ADDRESS = environmentAddress(
  "NEXT_PUBLIC_ZAMA_WRAPPERS_REGISTRY_ADDRESS",
  "0x2f0750Bbb0A246059d80e94c454586a7F27a128e",
);
export const POOL_FACTORY_ADDRESS = environmentAddress(
  "NEXT_PUBLIC_POOL_FACTORY_ADDRESS",
  "0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2",
);
export const POOL_FAUCET_ADDRESS = environmentAddress(
  "NEXT_PUBLIC_POOL_FAUCET_ADDRESS",
  "0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F",
);

export const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com";
