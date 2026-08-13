import type { Metadata } from "next";

import { TokensWorkspace } from "@/features/tokens/tokens-workspace";

export const metadata: Metadata = { title: "Tokens", description: "Manage public and confidential registry tokens for ZamOps Pool." };

export default function TokensPage() { return <TokensWorkspace />; }
