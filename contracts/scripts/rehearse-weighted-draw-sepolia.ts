import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { deployments, ethers, fhevm, network } from "hardhat";

import {
  EncryptedWeightedDrawSpike__factory,
  type EncryptedWeightedDrawSpike,
} from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const WEIGHTS = [10n, 30n, 60n] as const;
const MINIMUM_TEST_ETH = ethers.parseEther("0.002");
const MAX_RETRIES = 5;

type TransactionMetric = {
  label: string;
  hash: string;
  seconds: number;
  gasUsed: string;
  globalHCU?: number;
  maxHCUDepth?: number;
};

async function mine(
  label: string,
  transactionPromise: Promise<ContractTransactionResponse>,
): Promise<{ receipt: TransactionReceipt; metric: TransactionMetric }> {
  const startedAt = Date.now();
  const transaction = await transactionPromise;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${label} was not mined`);

  const metric: TransactionMetric = {
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
    // A remote receipt may omit the mock coprocessor logs used by the local HCU calculator.
  }

  console.info(`${label}: ${transaction.hash}`);
  return { receipt, metric };
}

async function recordWeight(
  draw: EncryptedWeightedDrawSpike,
  participant: HardhatEthersSigner,
  weight: bigint,
  metrics: TransactionMetric[],
) {
  const encrypted = await fhevm
    .createEncryptedInput(await draw.getAddress(), participant.address)
    .add64(weight)
    .encrypt();
  const { metric } = await mine(
    `encrypted deposit weight for ${participant.address}`,
    draw.connect(participant).recordEncryptedWeight(encrypted.handles[0], encrypted.inputProof),
  );
  metrics.push(metric);
}

async function publicDecryptAndSubmit(
  draw: EncryptedWeightedDrawSpike,
  phase: "total" | "result",
  metrics: TransactionMetric[],
) {
  const handle = phase === "total" ? await draw.totalWeightHandle() : await draw.resultHandle();
  const decryptStartedAt = Date.now();
  const decrypted = await fhevm.publicDecrypt([handle]);
  const decryptSeconds = Number(((Date.now() - decryptStartedAt) / 1_000).toFixed(1));

  const { metric } = await mine(
    phase === "total" ? "start encrypted selection" : "finalize encrypted selection",
    phase === "total"
      ? draw.startSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof)
      : draw.finalizeSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof),
  );
  metric.label += ` (public decryption ${decryptSeconds}s)`;
  metrics.push(metric);
}

async function decryptFor(
  draw: EncryptedWeightedDrawSpike,
  participant: HardhatEthersSigner,
  field: "weight" | "winnings",
) {
  const handle =
    field === "weight"
      ? await draw.encryptedWeightOf(participant.address)
      : await draw.encryptedWinningsOf(participant.address);
  return fhevm.userDecryptEuint(
    FhevmType.euint64,
    handle,
    await draw.getAddress(),
    participant,
  );
}

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (chain.chainId !== SEPOLIA_CHAIN_ID || network.name !== "sepolia") {
    throw new Error(`Rehearsal must run on Sepolia; received ${network.name} (${chain.chainId})`);
  }

  const signers = await ethers.getSigners();
  if (signers.length < WEIGHTS.length) {
    throw new Error("SEPOLIA_PRIVATE_KEYS must contain at least three unique funded wallets");
  }
  const participants = signers.slice(0, WEIGHTS.length);
  if (new Set(participants.map(({ address }) => address.toLowerCase())).size !== WEIGHTS.length) {
    throw new Error("The rehearsal wallets must be unique");
  }

  for (const participant of participants) {
    const balance = await ethers.provider.getBalance(participant.address);
    if (balance < MINIMUM_TEST_ETH) {
      throw new Error(`${participant.address} needs at least 0.002 Sepolia ETH`);
    }
  }

  // Hardhat tests initialize this through their test lifecycle. Standalone scripts must do it explicitly.
  await fhevm.initializeCLIApi();

  const deployment = await deployments.get("EncryptedWeightedDrawSpike");
  const draw = EncryptedWeightedDrawSpike__factory.connect(deployment.address, signers[0]);
  if ((await draw.state()) !== 0n) {
    throw new Error("The deployed spike is not fresh. Run npm run deploy:sepolia:fresh before rehearsing again.");
  }

  const metrics: TransactionMetric[] = [];
  for (let index = 0; index < participants.length; ++index) {
    await recordWeight(draw, participants[index], WEIGHTS[index], metrics);
  }

  const { metric: requestMetric } = await mine("freeze draw and request aggregate", draw.requestDraw());
  metrics.push(requestMetric);
  await publicDecryptAndSubmit(draw, "total", metrics);

  let attempts = 0;
  while ((await draw.state()) !== 4n && attempts < MAX_RETRIES) {
    while ((await draw.state()) === 2n) {
      const { metric } = await mine("process encrypted participant batch", draw.processSelectionBatch(3));
      metrics.push(metric);
    }
    await publicDecryptAndSubmit(draw, "result", metrics);
    ++attempts;
  }
  if ((await draw.state()) !== 4n) throw new Error(`Draw did not complete after ${MAX_RETRIES} attempts`);

  const results = [];
  for (let index = 0; index < participants.length; ++index) {
    const participant = participants[index];
    const startedAt = Date.now();
    const [weight, winnings] = await Promise.all([
      decryptFor(draw, participant, "weight"),
      decryptFor(draw, participant, "winnings"),
    ]);
    results.push({
      address: participant.address,
      expectedWeight: WEIGHTS[index].toString(),
      decryptedWeight: weight.toString(),
      decryptedWinnings: winnings.toString(),
      userDecryptionSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
    });
  }

  if (results.some(({ expectedWeight, decryptedWeight }) => expectedWeight !== decryptedWeight)) {
    throw new Error("A decrypted participant weight did not match its encrypted input");
  }
  if (results.reduce((sum, result) => sum + BigInt(result.decryptedWinnings), 0n) !== 1n) {
    throw new Error("The draw did not award exactly one encrypted prize unit");
  }

  console.info(
    JSON.stringify(
      {
        status: "passed",
        network: network.name,
        chainId: chain.chainId.toString(),
        contract: deployment.address,
        aggregateWeightRevealed: (await draw.revealedTotalWeight()).toString(),
        attempts,
        participants: results,
        transactions: metrics,
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
