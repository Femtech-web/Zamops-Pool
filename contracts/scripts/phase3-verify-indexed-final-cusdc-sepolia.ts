import { FhevmType } from "@fhevm/hardhat-plugin";
import type { Wallet } from "ethers";
import { mkdir, writeFile } from "node:fs/promises";
import { ethers, fhevm, network } from "hardhat";

import { ConfidentialPrizePool__factory } from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CUSDC_POOL = "0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327";
const DEPLOYMENT_BLOCK = 11_477_441;
const PRINCIPALS = [10_000_000n, 30_000_000n, 60_000_000n] as const;
const PRIZE = 50_000_000n;
const DEFAULT_ENDPOINT = "https://api.goldsky.com/api/public/project_cmsqxy20s9sno01ulf3j3aoqt/subgraphs/zamops-pool-sepolia/v0.0.3/gn";

type IndexedRow = { id: string; type: string; pool: string; encryptedAmount?: string; transactionHash: string; timestamp: string };

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Final indexed proof is Sepolia-only");
  await fhevm.initializeCLIApi();
  const endpoint = process.env.ZAMOPS_POOL_SUBGRAPH_URL ?? process.env.NEXT_PUBLIC_ZAMOPS_POOL_SUBGRAPH_URL ?? DEFAULT_ENDPOINT;
  const keys = (process.env.SEPOLIA_PRIVATE_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if (keys.length < 3) throw new Error("SEPOLIA_PRIVATE_KEYS must contain the three cUSDC rehearsal wallets");
  const wallets = keys.slice(0, 3).map((key) => new ethers.Wallet(key, ethers.provider));
  const pool = ConfidentialPrizePool__factory.connect(CUSDC_POOL, wallets[0]);
  const selectionEvents = await pool.queryFilter(pool.filters.SelectionStarted(3n), DEPLOYMENT_BLOCK);
  const drawThreeStartBlock = selectionEvents.at(-1)?.blockNumber;
  if (!drawThreeStartBlock) throw new Error("Draw #3 selection event is unavailable");
  const drawThreeStartTimestamp = Number((await ethers.provider.getBlock(drawThreeStartBlock))?.timestamp ?? 0);
  const proofs = [];
  let claimed = 0n;

  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index];
    const rows = (await waitForFinalRows(endpoint, wallet.address)).filter((row) => Number(row.timestamp) >= drawThreeStartTimestamp);
    const withdrawal = rows.find((row) => row.type === "WITHDRAWAL" && row.pool.toLowerCase() === CUSDC_POOL.toLowerCase());
    if (!withdrawal?.encryptedAmount) throw new Error(`Indexed withdrawal missing for wallet ${index + 1}`);
    const withdrawalProof = await decryptRow(withdrawal, wallet);
    if (withdrawalProof.clearAmount !== PRINCIPALS[index]) throw new Error(`Indexed withdrawal mismatch for wallet ${index + 1}`);

    const claims = rows.filter((row) => row.type === "PRIZE_CLAIMED" && row.pool.toLowerCase() === CUSDC_POOL.toLowerCase() && row.encryptedAmount);
    const claimProofs = await Promise.all(claims.map((row) => decryptRow(row, wallet)));
    claimed += claimProofs.reduce((total, proof) => total + proof.clearAmount, 0n);
    proofs.push({ wallet: wallet.address, withdrawal: serializable(withdrawalProof), claims: claimProofs.map(serializable) });
  }
  if (claimed !== PRIZE) throw new Error(`Indexed claims total ${claimed}, expected ${PRIZE}`);
  if (proofs.flatMap((proof) => proof.claims).filter((claim) => claim.clearAmount !== "0").length !== 1) throw new Error("Expected exactly one positive indexed prize claim");

  const report = { status: "passed", source: "Goldsky user-authorized final activity handles", pool: CUSDC_POOL, claimed: claimed.toString(), proofs };
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase3-cusdc-indexed-final.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.info(JSON.stringify(report, null, 2));
}

async function waitForFinalRows(endpoint: string, account: string) {
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const rows = await fetchActivities(endpoint, account);
    if (rows.some((row) => row.type === "WITHDRAWAL" && row.pool.toLowerCase() === CUSDC_POOL.toLowerCase())) return rows;
    if (attempt < 18) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Goldsky did not index the final cUSDC activity for ${account} within three minutes`);
}

async function decryptRow(row: IndexedRow, wallet: Wallet) {
  const started = Date.now();
  const clearAmount = await fhevm.userDecryptEuint(FhevmType.euint64, row.encryptedAmount!, CUSDC_POOL, wallet);
  return { indexedId: row.id, transactionHash: row.transactionHash, encryptedAmount: row.encryptedAmount!, clearAmount, decryptSeconds: Number(((Date.now() - started) / 1_000).toFixed(1)) };
}

function serializable(proof: Awaited<ReturnType<typeof decryptRow>>) {
  return { ...proof, clearAmount: proof.clearAmount.toString() };
}

async function fetchActivities(endpoint: string, account: string): Promise<IndexedRow[]> {
  const query = `query WalletActivity($account: Bytes!) { poolActivities(first: 30, orderBy: timestamp, orderDirection: desc, where: { account: $account }) { id type pool encryptedAmount transactionHash timestamp } }`;
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { account: account.toLowerCase() } }) });
  if (!response.ok) throw new Error(`Goldsky returned HTTP ${response.status}`);
  const payload = await response.json() as { data?: { poolActivities?: IndexedRow[] }; errors?: unknown[] };
  if (payload.errors || !payload.data?.poolActivities) throw new Error("Goldsky final activity query failed");
  return payload.data.poolActivities;
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
