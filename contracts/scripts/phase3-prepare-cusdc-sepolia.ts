import { FhevmType } from "@fhevm/hardhat-plugin";
import type { Signer, TransactionResponse } from "ethers";
import { mkdir, writeFile } from "node:fs/promises";
import { ethers, fhevm, network } from "hardhat";

import {
  ConfidentialPrizePool__factory,
  IConfidentialTokenWrapper__factory,
  IERC20Metadata__factory,
  ZamOpsPoolFactory__factory,
  ZamOpsPoolFaucet__factory,
} from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const FACTORY = "0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2";
const FAUCET = "0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F";
const CUSDC = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const DEPOSITS = [10_000_000n, 30_000_000n, 60_000_000n] as const;
const MAX_EXPIRY = 281_474_976_710_655n;

type RecordItem = { label: string; wallet: string; hash?: string; seconds: number; gasUsed?: string; value?: string };

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Phase 3 preparation is Sepolia-only");
  await fhevm.initializeCLIApi();

  const keys = (process.env.SEPOLIA_PRIVATE_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if (keys.length < 3) throw new Error("SEPOLIA_PRIVATE_KEYS must contain three funded rehearsal wallets");
  const participants = keys.slice(0, 3).map((key) => new ethers.Wallet(key, ethers.provider));
  if (new Set(participants.map((wallet) => wallet.address)).size !== 3) throw new Error("Phase 3 requires three unique wallets");

  const factory = ZamOpsPoolFactory__factory.connect(process.env.KEEPER_FACTORY_ADDRESS ?? FACTORY, participants[0]);
  const poolAddress = await factory.poolByAsset(CUSDC);
  if (poolAddress === ethers.ZeroAddress) throw new Error("Canonical cUSDC pool is unavailable");
  const pool = ConfidentialPrizePool__factory.connect(poolAddress, participants[0]);
  if (await pool.state() !== 0n) throw new Error(`Canonical cUSDC pool must be OPEN; current state is ${await pool.state()}`);

  const wrapper = IConfidentialTokenWrapper__factory.connect(CUSDC, participants[0]);
  const underlyingAddress = await wrapper.underlying();
  const faucet = ZamOpsPoolFaucet__factory.connect(process.env.KEEPER_FAUCET_ADDRESS ?? FAUCET, participants[0]);
  const records: RecordItem[] = [];

  for (let index = 0; index < participants.length; index += 1) {
    const wallet = participants[index];
    const connectedPool = pool.connect(wallet);
    const connectedWrapper = wrapper.connect(wallet);
    const underlying = IERC20Metadata__factory.connect(underlyingAddress, wallet);

    const oldWinnings = await decrypt(poolAddress, await pool.encryptedWinningsOf(wallet.address), wallet, `existing winnings wallet ${index + 1}`, records);
    if (oldWinnings > 0n) await mine(`claim existing winnings wallet ${index + 1}`, wallet.address, connectedPool.claim(), records);
    const oldPrincipal = await decrypt(poolAddress, await pool.encryptedPrincipalOf(wallet.address), wallet, `existing principal wallet ${index + 1}`, records);
    if (oldPrincipal > 0n) {
      const encrypted = await encrypt(poolAddress, wallet.address, oldPrincipal);
      await mine(`withdraw existing principal wallet ${index + 1}`, wallet.address, connectedPool.withdraw(encrypted.handles[0], encrypted.inputProof, { gasLimit: 2_500_000 }), records);
    }

    const required = DEPOSITS[index];
    const privateBalance = await decrypt(CUSDC, await wrapper.confidentialBalanceOf(wallet.address), wallet, `private token balance wallet ${index + 1}`, records);
    if (privateBalance < required) {
      const publicAmount = (required - privateBalance) * (await wrapper.rate());
      if (await underlying.balanceOf(wallet.address) < publicAmount) {
        await mine(`faucet wallet ${index + 1}`, wallet.address, faucet.connect(wallet).claim(underlyingAddress), records);
      }
      if (await underlying.balanceOf(wallet.address) < publicAmount) throw new Error(`Wallet ${index + 1} faucet balance is insufficient`);
      await mine(`approve Shield wallet ${index + 1}`, wallet.address, underlying.approve(CUSDC, publicAmount), records);
      await mine(`Shield cUSDC wallet ${index + 1}`, wallet.address, connectedWrapper.wrap(wallet.address, publicAmount), records);
    }
    if (!await wrapper.isOperator(wallet.address, poolAddress)) {
      await mine(`allow pool wallet ${index + 1}`, wallet.address, connectedWrapper.setOperator(poolAddress, MAX_EXPIRY), records);
    }
    const encrypted = await encrypt(poolAddress, wallet.address, required);
    await mine(`deposit wallet ${index + 1}`, wallet.address, connectedPool.deposit(encrypted.handles[0], encrypted.inputProof, { gasLimit: 2_500_000 }), records);
    const revealed = await decrypt(poolAddress, await pool.encryptedPrincipalOf(wallet.address), wallet, `reveal principal wallet ${index + 1}`, records);
    if (revealed !== required) throw new Error(`Wallet ${index + 1} principal mismatch: ${revealed}`);
  }

  const report = {
    status: "prepared",
    phase: 3,
    journey: "canonical-cusdc-10-30-60",
    factory: await factory.getAddress(),
    pool: poolAddress,
    asset: CUSDC,
    drawId: (await pool.drawId()).toString(),
    completedDrawsBefore: (await pool.completedDraws()).toString(),
    nextDrawAt: Number(await pool.nextDrawAt()),
    nextDrawAtIso: new Date(Number(await pool.nextDrawAt()) * 1_000).toISOString(),
    participants: participants.map((wallet, index) => ({ address: wallet.address, expectedPrincipal: DEPOSITS[index].toString() })),
    records,
  };
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase3-cusdc.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.info(JSON.stringify(report, null, 2));
}

async function encrypt(contract: string, user: string, value: bigint) {
  return fhevm.createEncryptedInput(contract, user).add64(value).encrypt();
}

async function decrypt(contract: string, handle: string, signer: Signer, label: string, records: RecordItem[]) {
  if (handle === ethers.ZeroHash) return 0n;
  const started = Date.now();
  const value = await fhevm.userDecryptEuint(FhevmType.euint64, handle, contract, signer);
  records.push({ label, wallet: await signer.getAddress(), seconds: elapsed(started), value: value.toString() });
  return value;
}

async function mine(label: string, wallet: string, pending: Promise<TransactionResponse>, records: RecordItem[]) {
  const started = Date.now();
  const transaction = await pending;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${label} was not mined`);
  records.push({ label, wallet, hash: transaction.hash, seconds: elapsed(started), gasUsed: receipt.gasUsed.toString() });
  console.info(`${label}: ${transaction.hash}`);
}

function elapsed(started: number) { return Number(((Date.now() - started) / 1_000).toFixed(1)); }

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
