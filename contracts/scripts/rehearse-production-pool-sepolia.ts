import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { deployments, ethers, fhevm, network } from "hardhat";

import {
  ConfidentialPrizePool__factory,
  IConfidentialTokenWrapper__factory,
  IERC20Metadata__factory,
  ZamOpsPoolFactory__factory,
  ZamOpsPoolFaucet__factory,
  type ConfidentialPrizePool,
} from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CUSDC = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const DEPOSIT_AMOUNTS = [10_000_000n, 30_000_000n, 60_000_000n] as const;
const PRIZE_AMOUNT = 50_000_000n;
const MAX_OPERATOR_EXPIRY = 281_474_976_710_655n;
const MAX_RETRIES = 5;

type Metric = {
  label: string;
  hash: string;
  seconds: number;
  gasUsed: string;
  globalHCU?: number;
  maxHCUDepth?: number;
};

async function mine(label: string, pending: Promise<ContractTransactionResponse>, metrics: Metric[]) {
  const startedAt = Date.now();
  const transaction = await pending;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${label} was not mined`);
  const metric: Metric = {
    label,
    hash: transaction.hash,
    seconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
    gasUsed: receipt.gasUsed.toString(),
  };
  try {
    const hcu = fhevm.computeTransactionHCU(receipt);
    metric.globalHCU = hcu.globalHCU;
    metric.maxHCUDepth = hcu.maxHCUDepth;
  } catch {
    // Remote receipts do not always expose the logs used by the local HCU calculator.
  }
  metrics.push(metric);
  console.info(`${label}: ${transaction.hash}`);
  return receipt;
}

async function encryptForPool(pool: ConfidentialPrizePool, signer: HardhatEthersSigner, amount: bigint) {
  return fhevm
    .createEncryptedInput(await pool.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
}

async function decryptPoolValue(
  pool: ConfidentialPrizePool,
  signer: HardhatEthersSigner,
  field: "principal" | "winnings",
) {
  const handle =
    field === "principal"
      ? await pool.encryptedPrincipalOf(signer.address)
      : await pool.encryptedWinningsOf(signer.address);
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, await pool.getAddress(), signer);
}

async function submitPublicDecryption(pool: ConfidentialPrizePool, phase: "total" | "result", metrics: Metric[]) {
  const handle = phase === "total" ? await pool.totalWeightHandle() : await pool.resultHandle();
  const startedAt = Date.now();
  const decrypted = await fhevm.publicDecrypt([handle]);
  const decryptSeconds = Number(((Date.now() - startedAt) / 1_000).toFixed(1));
  await mine(
    `${phase === "total" ? "start selection" : "finalize selection"} (decryption ${decryptSeconds}s)`,
    phase === "total"
      ? pool.startSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof)
      : pool.finalizeSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof),
    metrics,
  );
}

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`Production rehearsal requires Sepolia; received ${network.name} (${chain.chainId})`);
  }
  const participants = (await ethers.getSigners()).slice(0, 3);
  if (participants.length !== 3 || new Set(participants.map((item) => item.address)).size !== 3) {
    throw new Error("SEPOLIA_PRIVATE_KEYS must contain three unique wallets");
  }

  await fhevm.initializeCLIApi();
  const factoryDeployment = await deployments.get("ZamOpsPoolFactory");
  const faucetDeployment = await deployments.get("ZamOpsPoolFaucet");
  const factory = ZamOpsPoolFactory__factory.connect(factoryDeployment.address, participants[0]);
  const poolAddress = await factory.poolByAsset(CUSDC);
  if (poolAddress === ethers.ZeroAddress) throw new Error("The cUSDC pool is not deployed");
  const pool = ConfidentialPrizePool__factory.connect(poolAddress, participants[0]);
  const wrapper = IConfidentialTokenWrapper__factory.connect(CUSDC, participants[0]);
  const underlyingAddress = await wrapper.underlying();
  const faucet = ZamOpsPoolFaucet__factory.connect(faucetDeployment.address, participants[0]);
  const metrics: Metric[] = [];
  let revealedAggregate: bigint | undefined;

  for (let index = 0; index < participants.length; ++index) {
    const participant = participants[index];
    const connectedPool = pool.connect(participant);
    const connectedWrapper = wrapper.connect(participant);
    const underlying = IERC20Metadata__factory.connect(underlyingAddress, participant);
    const required = DEPOSIT_AMOUNTS[index] + (index === 0 ? PRIZE_AMOUNT : 0n);
    const currentPrincipal = await decryptPoolValue(pool, participant, "principal");
    if (currentPrincipal !== 0n) continue;

    const confidentialHandle = await wrapper.confidentialBalanceOf(participant.address);
    const confidentialBalance =
      confidentialHandle === ethers.ZeroHash
        ? 0n
        : await fhevm.userDecryptEuint(FhevmType.euint64, confidentialHandle, CUSDC, participant);
    if (confidentialBalance < required) {
      const wrapAmount = (required - confidentialBalance) * (await wrapper.rate());
      if ((await underlying.balanceOf(participant.address)) < wrapAmount) {
        await mine(
          `claim USDC faucet for wallet ${index + 1}`,
          faucet.connect(participant).claim(underlyingAddress),
          metrics,
        );
      }
      await mine(`approve USDC wrapper for wallet ${index + 1}`, underlying.approve(CUSDC, wrapAmount), metrics);
      await mine(`wrap USDC for wallet ${index + 1}`, connectedWrapper.wrap(participant.address, wrapAmount), metrics);
    }

    await mine(
      `approve pool operator for wallet ${index + 1}`,
      connectedWrapper.setOperator(poolAddress, MAX_OPERATOR_EXPIRY),
      metrics,
    );
    const encrypted = await encryptForPool(pool, participant, DEPOSIT_AMOUNTS[index]);
    await mine(
      `encrypted deposit for wallet ${index + 1}`,
      connectedPool.deposit(encrypted.handles[0], encrypted.inputProof),
      metrics,
    );
  }

  const latestBlock = await ethers.provider.getBlockNumber();
  const fundingEvents = await pool.queryFilter(
    pool.filters.EncryptedPrizeFunded(participants[0].address),
    Math.max(0, latestBlock - 20_000),
  );
  if (fundingEvents.length === 0) {
    const encryptedPrize = await encryptForPool(pool, participants[0], PRIZE_AMOUNT);
    await mine(
      "fund encrypted 50 cUSDC prize",
      pool.connect(participants[0]).fundPrize(encryptedPrize.handles[0], encryptedPrize.inputProof),
      metrics,
    );
  }

  const now = Math.floor(Date.now() / 1_000);
  const readyAt = Number(await pool.nextDrawAt());
  if ((await pool.completedDraws()) === 0n && now < readyAt) {
    console.info(
      JSON.stringify(
        {
          status: "prepared",
          pool: poolAddress,
          asset: CUSDC,
          readyAt,
          readyAtIso: new Date(readyAt * 1_000).toISOString(),
          secondsRemaining: readyAt - now,
          metrics,
        },
        null,
        2,
      ),
    );
    return;
  }

  if ((await pool.completedDraws()) === 0n) {
    if ((await pool.state()) === 0n) await mine("request production draw", pool.requestDraw(), metrics);
    if ((await pool.state()) === 1n) {
      await submitPublicDecryption(pool, "total", metrics);
      revealedAggregate = await pool.revealedTotalWeight();
    }
    let attempts = 0;
    while ((await pool.completedDraws()) === 0n && attempts < MAX_RETRIES) {
      while ((await pool.state()) === 2n) {
        await mine("process encrypted selection batch", pool.processSelectionBatch(3), metrics);
      }
      if ((await pool.state()) === 3n) {
        await submitPublicDecryption(pool, "result", metrics);
        ++attempts;
      }
    }
    if ((await pool.completedDraws()) === 0n) throw new Error(`No winner after ${MAX_RETRIES} attempts`);
  }
  while ((await pool.state()) === 4n) {
    await mine("synchronize next-draw weights", pool.processNextDrawSyncBatch(8), metrics);
  }

  const beforeClaim = [];
  for (let index = 0; index < participants.length; ++index) {
    const participant = participants[index];
    const [principal, winnings] = await Promise.all([
      decryptPoolValue(pool, participant, "principal"),
      decryptPoolValue(pool, participant, "winnings"),
    ]);
    beforeClaim.push({ address: participant.address, principal, winnings });
    if (winnings > 0n) await mine(`claim prize for wallet ${index + 1}`, pool.connect(participant).claim(), metrics);
    if (principal > 0n) {
      const encrypted = await encryptForPool(pool, participant, principal);
      await mine(
        `withdraw principal for wallet ${index + 1}`,
        pool.connect(participant).withdraw(encrypted.handles[0], encrypted.inputProof),
        metrics,
      );
    }
  }

  const finalPrincipals = await Promise.all(participants.map((participant) => decryptPoolValue(pool, participant, "principal")));
  if (finalPrincipals.some((value) => value !== 0n)) throw new Error("A participant principal was not fully withdrawn");
  if (beforeClaim.reduce((sum, item) => sum + item.winnings, 0n) !== PRIZE_AMOUNT) {
    throw new Error("The encrypted prize was not awarded exactly once");
  }

  if (revealedAggregate === undefined) {
    const latestBlock = await ethers.provider.getBlockNumber();
    const starts = await pool.queryFilter(
      pool.filters.SelectionStarted(1n),
      Math.max(0, latestBlock - 49_000),
      latestBlock,
    );
    revealedAggregate = starts.at(-1)?.args.revealedTotalWeight;
  }

  console.info(
    JSON.stringify(
      {
        status: "passed",
        pool: poolAddress,
        asset: CUSDC,
        revealedAggregate: revealedAggregate?.toString() ?? "unavailable",
        participants: beforeClaim.map((item) => ({
          address: item.address,
          principal: item.principal.toString(),
          winnings: item.winnings.toString(),
        })),
        finalPrincipals: finalPrincipals.map(String),
        metrics,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
