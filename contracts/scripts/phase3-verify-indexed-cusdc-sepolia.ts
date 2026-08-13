import { FhevmType } from "@fhevm/hardhat-plugin";
import { mkdir, writeFile } from "node:fs/promises";
import { ethers, fhevm, network } from "hardhat";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CUSDC_POOL = "0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327";
const EXPECTED = [10_000_000n, 30_000_000n, 60_000_000n] as const;
const DEFAULT_ENDPOINT = "https://api.goldsky.com/api/public/project_cmsqxy20s9sno01ulf3j3aoqt/subgraphs/zamops-pool-sepolia/v0.0.3/gn";

type IndexedRow = { id: string; type: string; pool: string; encryptedAmount?: string; transactionHash: string; timestamp: string };

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Indexed proof is Sepolia-only");
  await fhevm.initializeCLIApi();

  const endpoint = process.env.ZAMOPS_POOL_SUBGRAPH_URL ?? process.env.NEXT_PUBLIC_ZAMOPS_POOL_SUBGRAPH_URL ?? DEFAULT_ENDPOINT;
  const keys = (process.env.SEPOLIA_PRIVATE_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if (keys.length < 3) throw new Error("SEPOLIA_PRIVATE_KEYS must contain the three cUSDC rehearsal wallets");
  const wallets = keys.slice(0, 3).map((key) => new ethers.Wallet(key, ethers.provider));
  const proofs = [];

  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index];
    const row = await waitForLatestDeposit(endpoint, wallet.address);
    if (!row.encryptedAmount) throw new Error(`Indexed deposit for wallet ${index + 1} has no encrypted handle`);
    const started = Date.now();
    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, row.encryptedAmount, CUSDC_POOL, wallet);
    const decryptSeconds = Number(((Date.now() - started) / 1_000).toFixed(1));
    if (clear !== EXPECTED[index]) throw new Error(`Indexed amount mismatch for wallet ${index + 1}: ${clear}`);
    proofs.push({ wallet: wallet.address, indexedId: row.id, transactionHash: row.transactionHash, encryptedAmount: row.encryptedAmount, clearAmount: clear.toString(), decryptSeconds });
  }

  const report = { status: "passed", source: "Goldsky after local-state independence", pool: CUSDC_POOL, proofs };
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase3-cusdc-indexed.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.info(JSON.stringify(report, null, 2));
}

async function waitForLatestDeposit(endpoint: string, account: string) {
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const rows = await fetchActivities(endpoint, account);
    const deposit = rows.find((row) => row.type === "DEPOSIT" && row.pool.toLowerCase() === CUSDC_POOL.toLowerCase());
    if (deposit) return deposit;
    if (attempt < 18) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Goldsky did not index the cUSDC deposit for ${account} within three minutes`);
}

async function fetchActivities(endpoint: string, account: string): Promise<IndexedRow[]> {
  const query = `query WalletActivity($account: Bytes!) { poolActivities(first: 20, orderBy: timestamp, orderDirection: desc, where: { account: $account }) { id type pool encryptedAmount transactionHash timestamp } }`;
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { account: account.toLowerCase() } }) });
  if (!response.ok) throw new Error(`Goldsky returned HTTP ${response.status}`);
  const payload = await response.json() as { data?: { poolActivities?: IndexedRow[] }; errors?: unknown[] };
  if (payload.errors || !payload.data?.poolActivities) throw new Error("Goldsky activity query failed");
  return payload.data.poolActivities;
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
