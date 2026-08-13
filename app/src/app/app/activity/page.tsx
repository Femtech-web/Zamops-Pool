import type { Metadata } from "next";

import { ActivityWorkspace } from "@/features/activity/activity-workspace";

export const metadata: Metadata = {
  title: "Activity",
  description: "Review confirmed ZamOps Pool activity and Sepolia transaction proofs.",
};

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  return <ActivityWorkspace initialItemId={item} />;
}
