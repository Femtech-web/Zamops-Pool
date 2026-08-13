"use client";

import type { Address, Hex } from "viem";
import { useReadContracts } from "wagmi";

import { SEPOLIA_CHAIN_ID } from "@/config/contracts";
import { poolAbi } from "@/features/pool/abis";

export type PoolState = {
  lifecycle: number;
  nextDrawAt: number;
  drawId: number;
  completedDraws: number;
  participantCount: number;
  principalHandle: Hex;
  winningsHandle: Hex;
};

export function usePoolState(poolAddress: Address, account: Address) {
  const functions = ["state", "nextDrawAt", "drawId", "completedDraws", "participantCount", "encryptedPrincipalOf", "encryptedWinningsOf"] as const;
  const read = useReadContracts({
    contracts: functions.map((functionName) => ({
      address: poolAddress,
      abi: poolAbi,
      functionName,
      args: functionName === "encryptedPrincipalOf" || functionName === "encryptedWinningsOf" ? [account] : undefined,
      chainId: SEPOLIA_CHAIN_ID,
    })),
    query: { refetchInterval: 15_000 },
  });
  const values = read.data?.map((item) => item.status === "success" ? item.result : undefined);
  const data: PoolState | undefined = values?.every((value) => value !== undefined) ? {
    lifecycle: Number(values[0]),
    nextDrawAt: Number(values[1]),
    drawId: Number(values[2]),
    completedDraws: Number(values[3]),
    participantCount: Number(values[4]),
    principalHandle: values[5] as unknown as Hex,
    winningsHandle: values[6] as unknown as Hex,
  } : undefined;
  return { ...read, data };
}
