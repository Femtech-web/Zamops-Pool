import { FhevmType } from "@fhevm/hardhat-plugin";
import type { Signer, TransactionResponse } from "ethers";
import { deployments, ethers, fhevm, network } from "hardhat";

import {
  ConfidentialPrizePool__factory,
  IConfidentialTokenWrapper__factory,
  IERC20Metadata__factory,
  ZamOpsPoolFactory__factory,
  ZamOpsPoolFaucet__factory,
} from "../typechain-types";

const ASSET = "0x4e7b06d78965594eb5ef5414c357ca21e1554491"; // cUSDT: untouched pool for a deterministic one-participant draw.
const DEPOSIT = 10_000_000n;
const PRIZE = 5_000_000n;
const MAX_EXPIRY = 281_474_976_710_655n;

type RecordItem = { label: string; hash?: string; seconds: number; gasUsed?: string };

async function main() {
  if (network.name !== "sepolia") throw new Error("Fresh-wallet rehearsal is Sepolia-only");
  await fhevm.initializeCLIApi();
  const [owner, relayer, prizeFunder] = await ethers.getSigners();
  const fresh = ethers.Wallet.createRandom().connect(ethers.provider);
  const records: RecordItem[] = [];
  const factoryAddress = (await deployments.get("ZamOpsPoolFactory")).address;
  const faucetAddress = (await deployments.get("ZamOpsPoolFaucet")).address;
  const factory = ZamOpsPoolFactory__factory.connect(factoryAddress, owner);
  const poolAddress = await factory.poolByAsset(ASSET);
  const pool = ConfidentialPrizePool__factory.connect(poolAddress, owner);
  const wrapper = IConfidentialTokenWrapper__factory.connect(ASSET, owner);
  const underlyingAddress = await wrapper.underlying();
  const underlying = IERC20Metadata__factory.connect(underlyingAddress, fresh);
  const faucet = ZamOpsPoolFaucet__factory.connect(faucetAddress, relayer);

  await mine("fund one-use wallet gas", owner.sendTransaction({ to: fresh.address, value: ethers.parseEther("0.08") }), records);
  await mine("gasless faucet claim", faucet.claimFor(fresh.address, underlyingAddress), records);
  const publicAmount = (DEPOSIT + PRIZE) * (await wrapper.rate());
  await mine("approve wrapper", underlying.approve(ASSET, publicAmount), records);
  await mine("make cUSDT private", wrapper.connect(fresh).wrap(fresh.address, publicAmount), records);
  await mine("allow pool", wrapper.connect(fresh).setOperator(poolAddress, MAX_EXPIRY), records);
  const operatorReady = await wrapper.isOperator(fresh.address, poolAddress);
  const privateBalance = await decrypt(ASSET, await wrapper.confidentialBalanceOf(fresh.address), fresh);
  console.info(`pre-deposit checks: operator=${operatorReady}, privateBalance=${privateBalance}`);
  if (!operatorReady || privateBalance < DEPOSIT) throw new Error("Pre-deposit operator or private balance check failed");
  const depositInput = await fhevm.createEncryptedInput(poolAddress, fresh.address).add64(DEPOSIT).encrypt();
  await mine("encrypted deposit", pool.connect(fresh).deposit(depositInput.handles[0], depositInput.inputProof, { gasLimit: 2_500_000 }), records);

  const revealedPrincipal = await decrypt(poolAddress, await pool.encryptedPrincipalOf(fresh.address), fresh);
  if (revealedPrincipal !== DEPOSIT) throw new Error(`Fresh principal mismatch: ${revealedPrincipal}`);

  const prizeInput = await fhevm.createEncryptedInput(poolAddress, fresh.address).add64(PRIZE).encrypt();
  await mine("fund separate encrypted prize", pool.connect(fresh).fundPrize(prizeInput.handles[0], prizeInput.inputProof, { gasLimit: 2_000_000 }), records);

  if (await pool.state() === 0n) await mine("request draw", pool.requestDraw({ gasLimit: 2_000_000 }), records);
  if (await pool.state() === 1n) await publicPhase(pool, "total", records);
  while (await pool.state() === 2n) await mine("encrypted selection batch", pool.processSelectionBatch(8, { gasLimit: 3_000_000 }), records);
  while (await pool.state() === 3n) {
    await publicPhase(pool, "result", records);
    while (await pool.state() === 2n) await mine("encrypted selection retry", pool.processSelectionBatch(8, { gasLimit: 3_000_000 }), records);
  }
  while (await pool.state() === 4n) await mine("prepare next draw", pool.processNextDrawSyncBatch(8, { gasLimit: 3_000_000 }), records);

  const winnings = await decrypt(poolAddress, await pool.encryptedWinningsOf(fresh.address), fresh);
  if (winnings !== PRIZE) throw new Error(`Fresh wallet did not receive exact prize: ${winnings}`);
  await mine("confidential prize claim", pool.connect(fresh).claim(), records);
  const withdrawInput = await fhevm.createEncryptedInput(poolAddress, fresh.address).add64(DEPOSIT).encrypt();
  await mine("full principal withdrawal", pool.connect(fresh).withdraw(withdrawInput.handles[0], withdrawInput.inputProof, { gasLimit: 2_500_000 }), records);
  const finalPrincipal = await decrypt(poolAddress, await pool.encryptedPrincipalOf(fresh.address), fresh);
  if (finalPrincipal !== 0n) throw new Error(`Principal remains after withdrawal: ${finalPrincipal}`);

  console.info(JSON.stringify({
    status: "passed",
    note: "One-use wallet private key was generated in memory and was not printed or persisted.",
    wallet: fresh.address,
    pool: poolAddress,
    principalRevealed: revealedPrincipal.toString(),
    winningsRevealed: winnings.toString(),
    finalPrincipal: finalPrincipal.toString(),
    records,
  }, null, 2));
}

async function decrypt(pool: string, handle: string, signer: Signer) {
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, pool, signer);
}

async function publicPhase(pool: ReturnType<typeof ConfidentialPrizePool__factory.connect>, phase: "total" | "result", records: RecordItem[]) {
  const handle = phase === "total" ? await pool.totalWeightHandle() : await pool.resultHandle();
  const started = Date.now();
  const decrypted = await fhevm.publicDecrypt([handle]);
  records.push({ label: `${phase} public decryption`, seconds: elapsed(started) });
  await mine(
    phase === "total" ? "verify combined pool total" : "verify draw result",
    phase === "total"
      ? pool.startSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 3_500_000 })
      : pool.finalizeSelection([handle], decrypted.abiEncodedClearValues, decrypted.decryptionProof, { gasLimit: 2_500_000 }),
    records,
  );
}

async function mine(label: string, pending: Promise<TransactionResponse>, records: RecordItem[]) {
  const started = Date.now();
  const transaction = await pending;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${label} was not mined`);
  records.push({ label, hash: transaction.hash, seconds: elapsed(started), gasUsed: receipt.gasUsed.toString() });
  console.info(`${label}: ${transaction.hash}`);
}

function elapsed(started: number) { return Number(((Date.now() - started) / 1_000).toFixed(1)); }

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
