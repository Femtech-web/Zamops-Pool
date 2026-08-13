import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { POOL_FAUCET_ADDRESS, SEPOLIA_RPC_URL } from "@/config/contracts";
import { faucetAbi } from "@/features/pool/abis";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{ account: string; tokenAddress: string }>;
    const account = parseAddress(body.account);
    const tokenAddress = parseAddress(body.tokenAddress);
    const privateKey = normalizePrivateKey(process.env.FAUCET_RELAYER_PRIVATE_KEY);
    if (!privateKey) return NextResponse.json({ code: "RELAYER_UNAVAILABLE" }, { status: 503 });

    const relayer = privateKeyToAccount(privateKey);
    const transport = http(process.env.SEPOLIA_RPC_URL?.trim() || SEPOLIA_RPC_URL);
    const publicClient = createPublicClient({ chain: sepolia, transport });
    const walletClient = createWalletClient({ account: relayer, chain: sepolia, transport });
    const [authorized, sponsorBalance] = await Promise.all([
      publicClient.readContract({ address: POOL_FAUCET_ADDRESS, abi: faucetAbi, functionName: "relayers", args: [relayer.address] }),
      publicClient.getBalance({ address: relayer.address }),
    ]);
    if (!authorized) return NextResponse.json({ code: "RELAYER_UNAUTHORIZED" }, { status: 503 });
    if (sponsorBalance === BigInt(0)) return NextResponse.json({ code: "RELAYER_UNFUNDED" }, { status: 503 });
    const [, enabled, , nextClaimAt, canClaim] = await publicClient.readContract({
      address: POOL_FAUCET_ADDRESS,
      abi: faucetAbi,
      functionName: "getClaimStatus",
      args: [tokenAddress, account],
    });

    if (!enabled) return NextResponse.json({ code: "TOKEN_UNAVAILABLE" }, { status: 400 });
    if (!canClaim) return NextResponse.json({ code: "COOLDOWN", nextClaimAt: nextClaimAt.toString() }, { status: 429 });

    const hash = await walletClient.writeContract({ address: POOL_FAUCET_ADDRESS, abi: faucetAbi, functionName: "claimFor", args: [account, tokenAddress] });
    return NextResponse.json({ hash });
  } catch (cause) {
    console.error("Gasless faucet claim failed", cause instanceof Error ? cause.message : "Unknown server error");
    return NextResponse.json({ code: "CLAIM_FAILED" }, { status: 500 });
  }
}

function parseAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error("Invalid address");
  return getAddress(value);
}

function normalizePrivateKey(value?: string): Hex | undefined {
  const key = value?.trim();
  if (!key) return undefined;
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}
