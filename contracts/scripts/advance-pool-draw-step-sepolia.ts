import { ethers, fhevm, network } from "hardhat";

import { ConfidentialPrizePool__factory } from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const DEFAULT_CUSDC_POOL = "0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327";
const BATCH_SIZE = 8;

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Fallback is Sepolia-only");

  const signerIndex = positiveIntegerOrZero(process.env.FALLBACK_SIGNER_INDEX, 1);
  const rehearsalKeys = (process.env.SEPOLIA_PRIVATE_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  const configuredKey = rehearsalKeys[signerIndex];
  const signer = configuredKey ? new ethers.Wallet(configuredKey, ethers.provider) : (await ethers.getSigners())[signerIndex];
  if (!signer) throw new Error(`No fallback signer configured at FALLBACK_SIGNER_INDEX=${signerIndex}`);

  const poolAddress = ethers.getAddress(process.env.FALLBACK_POOL_ADDRESS ?? DEFAULT_CUSDC_POOL);
  const pool = ConfidentialPrizePool__factory.connect(poolAddress, signer);
  const stateBefore = Number(await pool.state());
  const nextDrawAt = Number(await pool.nextDrawAt());
  const now = Math.floor(Date.now() / 1_000);
  if (stateBefore === 0 && now < nextDrawAt) throw new Error(`Draw is not eligible for ${nextDrawAt - now} seconds`);
  if (stateBefore === 0 && await pool.participantCount() === 0n) throw new Error("Pool has no participants");

  let action: string;
  let transaction;
  if (stateBefore === 0) {
    action = "request draw";
    transaction = await pool.requestDraw({ gasLimit: 2_000_000 });
  } else if (stateBefore === 1 || stateBefore === 3) {
    await fhevm.initializeCLIApi();
    const handle = stateBefore === 1 ? await pool.totalWeightHandle() : await pool.resultHandle();
    const decrypted = await fhevm.publicDecrypt([handle]);
    if (stateBefore === 1) {
      action = "verify aggregate and start selection";
      transaction = await pool.startSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 3_500_000 });
    } else {
      action = "verify selection result";
      transaction = await pool.finalizeSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 2_500_000 });
    }
  } else if (stateBefore === 2) {
    action = "process encrypted selection";
    transaction = await pool.processSelectionBatch(BATCH_SIZE, { gasLimit: 3_000_000 });
  } else {
    action = "prepare next draw";
    transaction = await pool.processNextDrawSyncBatch(BATCH_SIZE, { gasLimit: 3_000_000 });
  }

  const receipt = await transaction.wait();
  if (!receipt) throw new Error("Fallback transaction was not mined");
  console.info(JSON.stringify({
    status: "confirmed",
    mode: "single-permissionless-step",
    caller: signer.address,
    pool: poolAddress,
    drawId: (await pool.drawId()).toString(),
    stateBefore,
    stateAfter: Number(await pool.state()),
    action,
    hash: transaction.hash,
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));
}

function positiveIntegerOrZero(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative signer index, received: ${value}`);
  return parsed;
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
