import type { Metadata } from "next";

import { PoolWorkspace } from "@/features/pool/pool-workspace";

export const metadata: Metadata = {
  title: "App",
  description: "Deposit, reveal, claim, and withdraw from ZamOps Pool on Sepolia.",
};

export default function AppPage() {
  return <PoolWorkspace />;
}
