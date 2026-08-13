import { ethers, fhevm, network } from "hardhat";
import type { ContractTransactionResponse } from "ethers";

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
const MAX_EXPIRY = 281_474_976_710_655n;
const DEPLOYMENT_BLOCK = 11_477_441;
const BATCH_SIZE = 8;

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

type RunRecord = { pool: string; asset: string; action: string; status: "confirmed" | "skipped" | "failed"; hash?: string; reason?: string };

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Keeper is Sepolia-only");
  await fhevm.initializeCLIApi();

  const [keeper] = await ethers.getSigners();
  if (!keeper) throw new Error("KEEPER_PRIVATE_KEY is not configured");
  const factoryAddress = process.env.KEEPER_FACTORY_ADDRESS ?? DEFAULT_FACTORY;
  const faucetAddress = process.env.KEEPER_FAUCET_ADDRESS ?? DEFAULT_FAUCET;
  const fundingEnabled = process.env.KEEPER_FUNDING_ENABLED !== "false";
  const dryRun = process.env.KEEPER_DRY_RUN === "true";
  const policies = configuredPolicies();
  const factory = ZamOpsPoolFactory__factory.connect(factoryAddress, keeper);
  const faucet = ZamOpsPoolFaucet__factory.connect(faucetAddress, keeper);
  const records: RunRecord[] = [];
  const poolCount = Number(await factory.poolCount());

  for (let index = 0; index < poolCount; index += 1) {
    const poolAddress = await factory.poolAt(index);
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
  }

  console.info(JSON.stringify({ status: records.some((record) => record.status === "failed") ? "partial" : "ok", keeper: keeper.address, records }, null, 2));
  if (records.some((record) => record.status === "failed")) process.exitCode = 1;
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
  await transaction.wait();
  return { pool: poolAddress, asset: assetAddress, action: `fund ${policy.amount} ${policy.symbol}`, status: "confirmed", hash: transaction.hash };
}

async function advanceToOpen(
  pool: ReturnType<typeof ConfidentialPrizePool__factory.connect>,
  records: RunRecord[],
  asset: string,
) {
  const poolAddress = await pool.getAddress();
  for (let step = 0; step < 20; step += 1) {
    const state = Number(await pool.state());
    if (state === 0) {
      if (Number(await pool.nextDrawAt()) > Math.floor(Date.now() / 1_000)) return;
      records.push(await recordTransaction(poolAddress, asset, "request draw", pool.requestDraw({ gasLimit: 2_000_000 })));
    } else if (state === 1 || state === 3) {
      const handle = state === 1 ? await pool.totalWeightHandle() : await pool.resultHandle();
      const decrypted = await fhevm.publicDecrypt([handle]);
      records.push(await recordTransaction(
        poolAddress,
        asset,
        state === 1 ? "verify aggregate and start selection" : "verify selection result",
        state === 1
          ? pool.startSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 3_500_000 })
          : pool.finalizeSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 2_500_000 }),
      ));
    } else if (state === 2) {
      records.push(await recordTransaction(poolAddress, asset, "process encrypted selection", pool.processSelectionBatch(BATCH_SIZE, { gasLimit: 3_000_000 })));
    } else if (state === 4) {
      records.push(await recordTransaction(poolAddress, asset, "prepare next draw", pool.processNextDrawSyncBatch(BATCH_SIZE, { gasLimit: 3_000_000 })));
    }
    if (Number(await pool.state()) === 0 && Number(await pool.nextDrawAt()) > Math.floor(Date.now() / 1_000)) return;
  }
  throw new Error("draw did not return to open state within 20 keeper actions");
}

async function prizeAlreadyPrepared(pool: ReturnType<typeof ConfidentialPrizePool__factory.connect>) {
  const [funding, requests, cancelled, completed, reopened] = await Promise.all([
    pool.queryFilter(pool.filters.EncryptedPrizeFunded(), DEPLOYMENT_BLOCK),
    pool.queryFilter(pool.filters.TotalDecryptionRequested(), DEPLOYMENT_BLOCK),
    pool.queryFilter(pool.filters.DrawCancelledEmpty(), DEPLOYMENT_BLOCK),
    pool.queryFilter(pool.filters.DrawCompleted(), DEPLOYMENT_BLOCK),
    pool.queryFilter(pool.filters.PoolReopened(), DEPLOYMENT_BLOCK),
  ]);
  const events = [
    ...funding.map((event) => ({ kind: "fund" as const, event })),
    ...requests.map((event) => ({ kind: "request" as const, event })),
    ...cancelled.map((event) => ({ kind: "cancel" as const, event })),
    ...completed.map((event) => ({ kind: "complete" as const, event })),
    ...reopened.map((event) => ({ kind: "reopen" as const, event })),
  ].sort((left, right) => left.event.blockNumber - right.event.blockNumber || left.event.index - right.event.index);

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

async function recordTransaction(pool: string, asset: string, action: string, pending: Promise<ContractTransactionResponse>): Promise<RunRecord> {
  const transaction = await pending;
  await transaction.wait();
  return { pool, asset, action, status: "confirmed", hash: transaction.hash };
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

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
