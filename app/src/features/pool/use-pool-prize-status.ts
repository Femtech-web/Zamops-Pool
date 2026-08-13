"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

export type PoolPrizeStatus = {
  phase: "OPEN" | "DRAWING" | "SYNCING";
  currentPrizeFunded: boolean;
  nextPrizeFunded: boolean;
  drawHadFundedPrize: boolean;
  revealedTotalWeight?: bigint;
};

const endpoint = process.env.NEXT_PUBLIC_ZAMOPS_POOL_SUBGRAPH_URL;
const pollMs = Number(process.env.NEXT_PUBLIC_POOL_STATUS_POLL_MS ?? 15_000);

export function usePoolPrizeStatus(poolAddress: Address) {
  return useQuery({
    queryKey: ["pool-prize-status", poolAddress.toLowerCase()],
    queryFn: async (): Promise<PoolPrizeStatus | null> => {
      const response = await fetch(endpoint!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `query PoolStatus($id: ID!) { poolStatus(id: $id) { phase currentPrizeFunded nextPrizeFunded drawHadFundedPrize revealedTotalWeight } }`,
          variables: { id: poolAddress.toLowerCase() },
        }),
      });
      if (!response.ok) throw new Error("Pool status index is unavailable");
      const payload = await response.json() as { data?: { poolStatus?: Omit<PoolPrizeStatus, "revealedTotalWeight"> & { revealedTotalWeight?: string | null } }; errors?: unknown[] };
      if (payload.errors) throw new Error("Pool status index returned an error");
      const status = payload.data?.poolStatus;
      if (!status) return null;
      return { ...status, revealedTotalWeight: status.revealedTotalWeight ? BigInt(status.revealedTotalWeight) : undefined };
    },
    enabled: Boolean(endpoint),
    refetchInterval: Number.isFinite(pollMs) ? pollMs : 15_000,
    retry: 2,
  });
}
