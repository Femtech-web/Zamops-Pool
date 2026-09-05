import { ethers, fhevm, network } from "hardhat";
import type { ContractTransactionResponse } from "ethers";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  ConfidentialPrizePool__factory,
  IConfidentialTokenWrapper__factory,
  IERC20Metadata__factory,
  ZamOpsPoolFactory__factory,
  ZamOpsPoolFaucet__factory,
} from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const DEFAULT_FACTORY = "0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2";
const DEFAULT_FAUCET = "0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F";
const DEFAULT_FAUCET_SPONSOR = "0xd04BBA49865f57840D4F03CCf541961906843AF1";
const MAX_EXPIRY = 281_474_976_710_655n;
const DEPLOYMENT_BLOCK = 11_477_441;
const LOG_QUERY_BLOCK_SPAN = 49_000;
const BATCH_SIZE = 8;
const DEFAULT_MIN_BALANCE_ETH = "0.02";
const DEFAULT_STALL_THRESHOLD_MINUTES = 20;
const DEFAULT_RPC_MAX_BLOCK_AGE_SECONDS = 180;
const DEFAULT_GOLDSKY_URL = "https://api.goldsky.com/api/public/project_cmsqxy20s9sno01ulf3j3aoqt/subgraphs/zamops-pool-sepolia/v0.0.3/gn";

type PrizePolicy = { symbol: string; amount: string };
const PUBLIC_MINT_POLICIES: Record<string, PrizePolicy> = {
  "0x7c5bf43b851c1dff1a4fee8db225b87f2c223639": { symbol: "cUSDC", amount: "50" },
  "0x4e7b06d78965594eb5ef5414c357ca21e1554491": { symbol: "cUSDT", amount: "25" },
  "0x46208622da27d91db4f0393733c8ba082ed83158": { symbol: "cWETH", amount: "1" },
  "0xaa5612fa27c927a0c7961f5aefee5ba3a0f9c891": { symbol: "cBRON", amount: "100" },
  "0xf2d628d2598af4eaf94cb76a437ff86ca78ffbfb": { symbol: "cZAMA", amount: "100" },
  "0xfce5c7069c5525ef6c8c2b2e35a745ba20a2f7cc": { symbol: "ctGBP", amount: "50" },
  "0xe4fcf848739845bc81dee1d5352cf3844f0a60c7": { symbol: "cXAUt", amount: "1" },
};

type RunRecord = {
  pool: string;
  asset: string;
  action: string;
  status: "confirmed" | "skipped" | "failed";
  hash?: string;
  gasUsed?: string;
  reason?: string;
};

type KeeperAlert = { kind: "low-balance" | "stalled-draw" | "rpc-stale" | "goldsky-unhealthy" | "faucet-sponsor"; message: string; pool?: string; asset?: string };

type KeeperReport = {
  version: 2;
  startedAt: string;
  completedAt: string;
  status: "ok" | "warning" | "failed";
  network: string;
  chainId: string;
  dryRun: boolean;
  keeper: { address: string; startingBalanceWei: string; endingBalanceWei: string; minimumBalanceWei: string };
  monitoring: {
    stallThresholdMinutes: number;
    rpc: { latestBlock: number; blockAgeSeconds: number; maximumBlockAgeSeconds: number };
    goldsky: { endpoint: string; indexedBlock?: number; hasIndexingErrors?: boolean; healthy: boolean };
    faucetSponsor: { address: string; authorized: boolean; balanceWei: string; minimumBalanceWei: string };
    alerts: KeeperAlert[];
  };
  records: RunRecord[];
};

async function main() {
  if (flagDisabled(process.env.KEEPER_ENABLED)) {
    console.info(JSON.stringify({ status: "paused", reason: "KEEPER_ENABLED disables all keeper transactions" }, null, 2));
    return;
  }
  const startedAt = new Date().toISOString();
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Keeper is Sepolia-only");
  await fhevm.initializeCLIApi();

  const [keeper] = await ethers.getSigners();
  if (!keeper) throw new Error("KEEPER_PRIVATE_KEY is not configured");
  const factoryAddress = process.env.KEEPER_FACTORY_ADDRESS ?? DEFAULT_FACTORY;
  const faucetAddress = process.env.KEEPER_FAUCET_ADDRESS ?? DEFAULT_FAUCET;
  const fundingEnabled = !flagDisabled(process.env.KEEPER_FUNDING_ENABLED);
  const dryRun = process.env.KEEPER_DRY_RUN === "true";
  const onlyPool = process.env.KEEPER_POOL_ADDRESS ? ethers.getAddress(process.env.KEEPER_POOL_ADDRESS) : undefined;
  const minimumBalance = ethers.parseEther(process.env.KEEPER_MIN_BALANCE_ETH ?? DEFAULT_MIN_BALANCE_ETH);
  const faucetSponsorMinimumBalance = ethers.parseEther(process.env.KEEPER_FAUCET_SPONSOR_MIN_BALANCE_ETH ?? DEFAULT_MIN_BALANCE_ETH);
  const stallThresholdMinutes = positiveInteger(process.env.KEEPER_STALL_THRESHOLD_MINUTES, DEFAULT_STALL_THRESHOLD_MINUTES);
  const maximumBlockAgeSeconds = positiveInteger(process.env.KEEPER_RPC_MAX_BLOCK_AGE_SECONDS, DEFAULT_RPC_MAX_BLOCK_AGE_SECONDS);
  const startingBalance = await ethers.provider.getBalance(keeper.address);
  const policies = configuredPolicies();
  const factory = ZamOpsPoolFactory__factory.connect(factoryAddress, keeper);
  const faucet = ZamOpsPoolFaucet__factory.connect(faucetAddress, keeper);
  const records: RunRecord[] = [];
  const alerts: KeeperAlert[] = [];
  const rpc = await inspectRpc(maximumBlockAgeSeconds, alerts);
  const goldsky = await inspectGoldsky(process.env.KEEPER_GOLDSKY_URL?.trim() || DEFAULT_GOLDSKY_URL, alerts);
  const faucetSponsorAddress = ethers.getAddress(process.env.KEEPER_FAUCET_SPONSOR_ADDRESS?.trim() || DEFAULT_FAUCET_SPONSOR);
  const [faucetSponsorAuthorized, faucetSponsorBalance] = await Promise.all([
    faucet.relayers(faucetSponsorAddress),
    ethers.provider.getBalance(faucetSponsorAddress),
  ]);
  if (!faucetSponsorAuthorized) alerts.push({ kind: "faucet-sponsor", message: `Configured faucet sponsor ${faucetSponsorAddress} is not authorized` });
  if (faucetSponsorBalance < faucetSponsorMinimumBalance) alerts.push({ kind: "faucet-sponsor", message: `Faucet sponsor balance ${ethers.formatEther(faucetSponsorBalance)} ETH is below the ${ethers.formatEther(faucetSponsorMinimumBalance)} ETH minimum` });
  const poolCount = Number(await factory.poolCount());

  for (let index = 0; index < poolCount; index += 1) {
    const poolAddress = await factory.poolAt(index);
    if (onlyPool && poolAddress.toLowerCase() !== onlyPool.toLowerCase()) continue;
    const pool = ConfidentialPrizePool__factory.connect(poolAddress, keeper);
    const asset = (await pool.asset()).toLowerCase();
    const participants = await pool.participantCount();

    if (participants === 0n) {
      records.push({ pool: poolAddress, asset, action: "inspect", status: "skipped", reason: "no participants" });
      continue;
    }

    if (fundingEnabled && Number(await pool.state()) === 0) {
      const policy = policies[asset];
      if (policy && !(await prizeAlreadyPrepared(pool))) {
        try {
          if (dryRun) records.push({ pool: poolAddress, asset, action: `fund ${policy.amount} ${policy.symbol}`, status: "skipped", reason: "dry run" });
          else records.push(await fundPrize(poolAddress, asset, policy, faucet));
        } catch (cause) {
          records.push({ pool: poolAddress, asset, action: `fund ${policy.amount} ${policy.symbol}`, status: "failed", reason: cause instanceof Error ? cause.message : "unknown funding failure" });
        }
      }
    }

    try {
      const ready = Number(await pool.nextDrawAt()) <= Math.floor(Date.now() / 1_000);
      if (!ready && Number(await pool.state()) === 0) {
        records.push({ pool: poolAddress, asset, action: "draw", status: "skipped", reason: "not ready" });
        continue;
      }
      if (dryRun) {
        records.push({ pool: poolAddress, asset, action: "advance draw", status: "skipped", reason: "dry run" });
        continue;
      }
      await advanceToOpen(pool, records, asset);
    } catch (cause) {
      records.push({ pool: poolAddress, asset, action: "automation", status: "failed", reason: cause instanceof Error ? cause.message : "unknown failure" });
    }

    if (!dryRun) {
      const state = Number(await pool.state());
      const nextDrawAt = Number(await pool.nextDrawAt());
      const overdueSeconds = Math.floor(Date.now() / 1_000) - nextDrawAt;
      if (overdueSeconds >= stallThresholdMinutes * 60 && (state !== 0 || participants > 0n)) {
        alerts.push({
          kind: "stalled-draw",
          pool: poolAddress,
          asset,
          message: `Draw #${await pool.drawId()} remains in state ${state} ${Math.floor(overdueSeconds / 60)} minutes after eligibility`,
        });
      }
    }
  }

  const endingBalance = await ethers.provider.getBalance(keeper.address);
  if (endingBalance < minimumBalance) {
    alerts.push({
      kind: "low-balance",
      message: `Keeper balance ${ethers.formatEther(endingBalance)} ETH is below the ${ethers.formatEther(minimumBalance)} ETH minimum`,
    });
  }
  const failed = records.some((record) => record.status === "failed");
  const report: KeeperReport = {
    version: 2,
    startedAt,
    completedAt: new Date().toISOString(),
    status: failed ? "failed" : alerts.length > 0 ? "warning" : "ok",
    network: network.name,
    chainId: chain.chainId.toString(),
    dryRun,
    keeper: {
      address: keeper.address,
      startingBalanceWei: startingBalance.toString(),
      endingBalanceWei: endingBalance.toString(),
      minimumBalanceWei: minimumBalance.toString(),
    },
    monitoring: {
      stallThresholdMinutes,
      rpc,
      goldsky,
      faucetSponsor: { address: faucetSponsorAddress, authorized: faucetSponsorAuthorized, balanceWei: faucetSponsorBalance.toString(), minimumBalanceWei: faucetSponsorMinimumBalance.toString() },
      alerts,
    },
    records,
  };
  await publishReport(report);
  console.info(JSON.stringify(report, null, 2));
  if (failed || alerts.length > 0) process.exitCode = 1;
}

async function fundPrize(
  poolAddress: string,
  assetAddress: string,
  policy: PrizePolicy,
  faucet: ReturnType<typeof ZamOpsPoolFaucet__factory.connect>,
): Promise<RunRecord> {
  const [keeper] = await ethers.getSigners();
  const wrapper = IConfidentialTokenWrapper__factory.connect(assetAddress, keeper);
  const underlyingAddress = await wrapper.underlying();
  const underlying = IERC20Metadata__factory.connect(underlyingAddress, keeper);
  const confidentialAmount = ethers.parseUnits(policy.amount, 6);
  const publicAmount = confidentialAmount * (await wrapper.rate());

  if ((await underlying.balanceOf(keeper.address)) < publicAmount) await mine(faucet.claim(underlyingAddress));
  if ((await underlying.balanceOf(keeper.address)) < publicAmount) throw new Error(`faucet did not provide enough ${policy.symbol}`);
  await mine(underlying.approve(assetAddress, publicAmount));
  await mine(wrapper.wrap(keeper.address, publicAmount));
  if (!(await wrapper.isOperator(keeper.address, poolAddress))) await mine(wrapper.setOperator(poolAddress, MAX_EXPIRY));

  const encrypted = await fhevm.createEncryptedInput(poolAddress, keeper.address).add64(confidentialAmount).encrypt();
  const pool = ConfidentialPrizePool__factory.connect(poolAddress, keeper);
  const transaction = await pool.fundPrize(encrypted.handles[0], encrypted.inputProof, { gasLimit: 2_000_000 });
  const receipt = await transaction.wait();
  if (!receipt) throw new Error("prize funding transaction was not mined");
  return { pool: poolAddress, asset: assetAddress, action: `fund ${policy.amount} ${policy.symbol}`, status: "confirmed", hash: transaction.hash, gasUsed: receipt.gasUsed.toString() };
}

async function advanceToOpen(
  pool: ReturnType<typeof ConfidentialPrizePool__factory.connect>,
  records: RunRecord[],
  asset: string,
) {
  const poolAddress = await pool.getAddress();
  let state = Number(await pool.state());
  for (let step = 0; step < 20; step += 1) {
    let mined: Awaited<ReturnType<typeof recordTransaction>>;
    if (state === 0) {
      if (Number(await pool.nextDrawAt()) > Math.floor(Date.now() / 1_000)) return;
      mined = await recordTransaction(poolAddress, asset, "request draw", pool.requestDraw({ gasLimit: 2_000_000 }));
    } else if (state === 1 || state === 3) {
      const handle = state === 1 ? await pool.totalWeightHandle() : await pool.resultHandle();
      const decrypted = await fhevm.publicDecrypt([handle]);
      mined = await recordTransaction(
        poolAddress,
        asset,
        state === 1 ? "verify aggregate and start selection" : "verify selection result",
        state === 1
          ? pool.startSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 3_500_000 })
          : pool.finalizeSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 2_500_000 }),
      );
    } else if (state === 2) {
      mined = await recordTransaction(poolAddress, asset, "process encrypted selection", pool.processSelectionBatch(BATCH_SIZE, { gasLimit: 3_000_000 }));
    } else if (state === 4) {
      mined = await recordTransaction(poolAddress, asset, "prepare next draw", pool.processNextDrawSyncBatch(BATCH_SIZE, { gasLimit: 3_000_000 }));
    } else {
      throw new Error(`unknown draw state ${state}`);
    }
    records.push(mined.record);

    // A public RPC may briefly route `latest` reads to a lagging backend. Pin the
    // lifecycle read to the receipt block so a confirmed transition is never repeated.
    state = Number(await pool.state({ blockTag: mined.blockNumber }));
    if (state === 0 && Number(await pool.nextDrawAt({ blockTag: mined.blockNumber })) > Math.floor(Date.now() / 1_000)) return;
  }
  throw new Error("draw did not return to open state within 20 keeper actions");
}

async function prizeAlreadyPrepared(pool: ReturnType<typeof ConfidentialPrizePool__factory.connect>) {
  const kindByEvent = {
    EncryptedPrizeFunded: "fund",
    TotalDecryptionRequested: "request",
    DrawCancelledEmpty: "cancel",
    DrawCompleted: "complete",
    PoolReopened: "reopen",
  } as const;
  const lifecycleTopics = (Object.keys(kindByEvent) as Array<keyof typeof kindByEvent>)
    .map((name) => pool.interface.getEvent(name)!.topicHash);
  const latestBlock = await ethers.provider.getBlockNumber();
  const poolAddress = await pool.getAddress();
  const events: Array<{
    kind: (typeof kindByEvent)[keyof typeof kindByEvent];
    blockNumber: number;
    index: number;
  }> = [];

  // Public RPCs commonly cap eth_getLogs at 50,000 blocks. Page the lifecycle
  // history so the keeper remains reliable as Sepolia moves beyond deployment.
  for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= latestBlock; fromBlock += LOG_QUERY_BLOCK_SPAN) {
    const toBlock = Math.min(fromBlock + LOG_QUERY_BLOCK_SPAN - 1, latestBlock);
    const logs = await ethers.provider.getLogs({
      address: poolAddress,
      fromBlock,
      toBlock,
      topics: [lifecycleTopics],
    });
    for (const log of logs) {
      const parsed = pool.interface.parseLog(log);
      if (!parsed || !(parsed.name in kindByEvent)) continue;
      const eventName = parsed.name as keyof typeof kindByEvent;
      events.push({ kind: kindByEvent[eventName], blockNumber: log.blockNumber, index: log.index });
    }
  }
  events.sort((left, right) => left.blockNumber - right.blockNumber || left.index - right.index);

  let phase: "open" | "drawing" | "syncing" = "open";
  let currentFunded = false;
  let nextFunded = false;
  let drawHadFundedPrize = false;
  for (const item of events) {
    if (item.kind === "fund") {
      if (phase === "open") currentFunded = true;
      else nextFunded = true;
    } else if (item.kind === "request") {
      phase = "drawing";
      drawHadFundedPrize = currentFunded;
      currentFunded = false;
    } else if (item.kind === "cancel") {
      phase = "syncing";
      nextFunded = nextFunded || drawHadFundedPrize;
      drawHadFundedPrize = false;
    } else if (item.kind === "complete") {
      phase = "syncing";
      drawHadFundedPrize = false;
    } else {
      phase = "open";
      currentFunded = nextFunded;
      nextFunded = false;
    }
  }
  return currentFunded;
}

async function recordTransaction(pool: string, asset: string, action: string, pending: Promise<ContractTransactionResponse>) {
  const transaction = await pending;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${action} transaction was not mined`);
  return {
    blockNumber: receipt.blockNumber,
    record: { pool, asset, action, status: "confirmed", hash: transaction.hash, gasUsed: receipt.gasUsed.toString() } satisfies RunRecord,
  };
}

async function mine(pending: Promise<ContractTransactionResponse>) {
  const transaction = await pending;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error("transaction was not mined");
  return receipt;
}

function configuredPolicies() {
  const override = process.env.KEEPER_PRIZE_CONFIG_JSON;
  if (!override) return PUBLIC_MINT_POLICIES;
  const amounts = JSON.parse(override) as Record<string, string>;
  const policies = { ...PUBLIC_MINT_POLICIES };
  for (const [asset, amount] of Object.entries(amounts)) {
    const key = asset.toLowerCase();
    if (!policies[key]) throw new Error(`Unsupported automatic prize asset: ${asset}`);
    policies[key] = { ...policies[key], amount };
  }
  return policies;
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

function flagDisabled(value: string | undefined) {
  return ["false", "0", "off", "no"].includes(value?.trim().toLowerCase() ?? "");
}

async function inspectRpc(maximumBlockAgeSeconds: number, alerts: KeeperAlert[]) {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Sepolia RPC returned no latest block");
  const blockAgeSeconds = Math.max(0, Math.floor(Date.now() / 1_000) - block.timestamp);
  if (blockAgeSeconds > maximumBlockAgeSeconds) alerts.push({ kind: "rpc-stale", message: `Sepolia RPC latest block is ${blockAgeSeconds}s old (maximum ${maximumBlockAgeSeconds}s)` });
  return { latestBlock: block.number, blockAgeSeconds, maximumBlockAgeSeconds };
}

async function inspectGoldsky(endpoint: string, alerts: KeeperAlert[]) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ _meta { block { number } hasIndexingErrors } }" }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { data?: { _meta?: { block?: { number?: number }; hasIndexingErrors?: boolean } }; errors?: unknown };
    const meta = payload.data?._meta;
    if (payload.errors || !meta?.block?.number || meta.hasIndexingErrors) throw new Error(meta?.hasIndexingErrors ? "indexing errors reported" : "invalid metadata response");
    return { endpoint, indexedBlock: meta.block.number, hasIndexingErrors: Boolean(meta.hasIndexingErrors), healthy: true };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown Goldsky failure";
    alerts.push({ kind: "goldsky-unhealthy", message: `Goldsky health check failed: ${reason}` });
    return { endpoint, healthy: false };
  }
}

async function publishReport(report: KeeperReport) {
  const reportPath = process.env.KEEPER_REPORT_PATH;
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const confirmed = report.records.filter((record) => record.status === "confirmed");
  const gasUsed = confirmed.reduce((total, record) => total + BigInt(record.gasUsed ?? 0), 0n);
  const lines = [
    "## Sepolia pool keeper",
    "",
    `**Status:** ${report.status}  `,
    `**Keeper balance:** ${ethers.formatEther(report.keeper.endingBalanceWei)} ETH  `,
    `**RPC block age:** ${report.monitoring.rpc.blockAgeSeconds}s  `,
    `**Goldsky:** ${report.monitoring.goldsky.healthy ? `healthy at block ${report.monitoring.goldsky.indexedBlock}` : "unhealthy"}  `,
    `**Faucet sponsor:** ${report.monitoring.faucetSponsor.authorized ? "authorized" : "unauthorized"}  `,
    `**Confirmed transactions:** ${confirmed.length}  `,
    `**Gas used:** ${gasUsed.toString()}  `,
    `**Pools inspected:** ${new Set(report.records.map((record) => record.pool)).size}`,
    "",
  ];
  if (report.monitoring.alerts.length > 0) {
    lines.push("### Alerts", "", ...report.monitoring.alerts.map((alert) => `- ${alert.message}`), "");
  }
  const failures = report.records.filter((record) => record.status === "failed");
  if (failures.length > 0) lines.push("### Failures", "", ...failures.map((record) => `- \`${record.pool}\` — ${record.action}: ${record.reason ?? "unknown failure"}`), "");
  await writeFile(summaryPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
