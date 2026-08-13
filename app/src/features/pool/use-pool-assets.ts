"use client";

import { useMemo } from "react";
import { zeroAddress, type Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";

import { POOL_FACTORY_ADDRESS, SEPOLIA_CHAIN_ID, WRAPPERS_REGISTRY_ADDRESS } from "@/config/contracts";
import { poolFactoryAbi, wrappersRegistryAbi } from "@/features/pool/abis";
import { knownToken } from "@/features/pool/token-metadata";
import type { KnownToken } from "@/features/pool/token-metadata";

type Pair = { tokenAddress: Address; confidentialTokenAddress: Address; isValid: boolean };
export type PoolAsset = Pair & { poolAddress: Address } & KnownToken;

export function usePoolAssets() {
  const pairsRead = useReadContract({
    address: WRAPPERS_REGISTRY_ADDRESS,
    abi: wrappersRegistryAbi,
    functionName: "getTokenConfidentialTokenPairs",
    chainId: SEPOLIA_CHAIN_ID,
    query: { staleTime: 60_000 },
  });
  const validPairs = useMemo(() => ((pairsRead.data ?? []) as readonly Pair[]).filter((pair) => pair.isValid), [pairsRead.data]);
  const poolsRead = useReadContracts({
    contracts: validPairs.map((pair) => ({
      address: POOL_FACTORY_ADDRESS,
      abi: poolFactoryAbi,
      functionName: "poolByAsset" as const,
      args: [pair.confidentialTokenAddress] as const,
      chainId: SEPOLIA_CHAIN_ID,
    })),
    allowFailure: true,
    query: { enabled: validPairs.length > 0, staleTime: 60_000 },
  });
  const assets = useMemo<PoolAsset[]>(() => validPairs.flatMap((pair, index) => {
    const entry = poolsRead.data?.[index];
    if (!entry || entry.status !== "success" || entry.result === zeroAddress) return [];
    return [{ ...pair, poolAddress: entry.result as Address, ...knownToken(pair.confidentialTokenAddress) }];
  }), [poolsRead.data, validPairs]);

  return { assets, isLoading: pairsRead.isLoading || poolsRead.isLoading, error: pairsRead.error ?? poolsRead.error };
}
