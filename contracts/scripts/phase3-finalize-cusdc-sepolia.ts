import { FhevmType } from "@fhevm/hardhat-plugin";
import type { Signer, TransactionResponse } from "ethers";
import { mkdir, writeFile } from "node:fs/promises";
import { ethers, fhevm, network } from "hardhat";

import { ConfidentialPrizePool__factory } from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CUSDC_POOL = "0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327";
const DEPLOYMENT_BLOCK = 11_477_441;
const PRINCIPALS = [10_000_000n, 30_000_000n, 60_000_000n] as const;
const PRIZE = 50_000_000n;

type RecordItem = { label: string; wallet: string; hash?: string; seconds: number; gasUsed?: string; value?: string };

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("Phase 3 finalization is Sepolia-only");
  await fhevm.initializeCLIApi();

  const keys = (process.env.SEPOLIA_PRIVATE_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if (keys.length < 3) throw new Error("SEPOLIA_PRIVATE_KEYS must contain the three cUSDC rehearsal wallets");
  const wallets = keys.slice(0, 3).map((key) => new ethers.Wallet(key, ethers.provider));
  const pool = ConfidentialPrizePool__factory.connect(CUSDC_POOL, wallets[0]);
  const state = Number(await pool.state());
  const completedDraws = await pool.completedDraws();
  if (state !== 0 || completedDraws < 3n) {
    throw new Error(`Automated draw #3 is not complete: state=${state}, completedDraws=${completedDraws}`);
  }

  const records: RecordItem[] = [];
  const revealed = [];
  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index];
    const principal = await decrypt(await pool.encryptedPrincipalOf(wallet.address), wallet, `reveal principal wallet ${index + 1}`, records);
    const winnings = await decrypt(await pool.encryptedWinningsOf(wallet.address), wallet, `reveal winnings wallet ${index + 1}`, records);
    if (principal !== PRINCIPALS[index]) throw new Error(`Wallet ${index + 1} principal changed: ${principal}`);
    revealed.push({ address: wallet.address, principal, winnings });
  }
  const selectionEvents = await pool.queryFilter(pool.filters.SelectionStarted(3n), DEPLOYMENT_BLOCK);
  const drawThreeStart = selectionEvents.at(-1)?.blockNumber;
  if (!drawThreeStart) throw new Error("Draw #3 selection event is unavailable");
  const claimEvents = await pool.queryFilter(pool.filters.EncryptedPrizeClaimed(), drawThreeStart);
  const walletByAddress = new Map(wallets.map((wallet) => [wallet.address.toLowerCase(), wallet]));
  const priorClaims = [];
  for (const event of claimEvents) {
    const wallet = walletByAddress.get(event.args.participant.toLowerCase());
    if (!wallet) continue;
    const amount = await decrypt(event.args.encryptedAmount, wallet, `reveal prior claim ${event.transactionHash}`, records);
    priorClaims.push({ wallet: wallet.address, hash: event.transactionHash, amount });
  }
  console.info(JSON.stringify({ revealed: serializeRevealed(revealed), priorClaims: serializeClaims(priorClaims) }, null, 2));
  const accountedPrize = revealed.reduce((total, item) => total + item.winnings, 0n) + priorClaims.reduce((total, item) => total + item.amount, 0n);
  const positiveAwards = revealed.filter((item) => item.winnings > 0n).length + priorClaims.filter((item) => item.amount > 0n).length;
  if (accountedPrize !== PRIZE || positiveAwards !== 1) {
    await writeReport({
      status: "failed",
      phase: 3,
      journey: "canonical-cusdc-10-30-60",
      pool: CUSDC_POOL,
      completedDraws: completedDraws.toString(),
      reason: `Expected one ${PRIZE.toString()} unit prize; current winnings plus indexed claims account for ${accountedPrize.toString()} across ${positiveAwards} positive awards`,
      revealed: serializeRevealed(revealed),
      priorClaims: serializeClaims(priorClaims),
      records,
    });
    throw new Error("Draw #3 prize accounting failed; no claim or withdrawal was submitted");
  }

  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index];
    const connected = pool.connect(wallet);
    if (revealed[index].winnings > 0n) await mine(`claim prize wallet ${index + 1}`, wallet.address, connected.claim(), records);
    const encrypted = await fhevm.createEncryptedInput(CUSDC_POOL, wallet.address).add64(PRINCIPALS[index]).encrypt();
    await mine(`withdraw principal wallet ${index + 1}`, wallet.address, connected.withdraw(encrypted.handles[0], encrypted.inputProof, { gasLimit: 2_500_000 }), records);
  }

  const finalPrincipals = [];
  for (let index = 0; index < wallets.length; index += 1) {
    const value = await decrypt(await pool.encryptedPrincipalOf(wallets[index].address), wallets[index], `verify final principal wallet ${index + 1}`, records);
    if (value !== 0n) throw new Error(`Wallet ${index + 1} final principal is not zero`);
    finalPrincipals.push(value.toString());
  }

  const report = {
    status: "passed",
    phase: 3,
    journey: "canonical-cusdc-10-30-60",
    pool: CUSDC_POOL,
    completedDraws: completedDraws.toString(),
    revealed: serializeRevealed(revealed),
    priorClaims: serializeClaims(priorClaims),
    finalPrincipals,
    records,
  };
  await writeReport(report);
  console.info(JSON.stringify(report, null, 2));
}

function serializeRevealed(revealed: Array<{ address: string; principal: bigint; winnings: bigint }>) {
  return revealed.map((item) => ({ address: item.address, principal: item.principal.toString(), winnings: item.winnings.toString() }));
}

function serializeClaims(claims: Array<{ wallet: string; hash: string; amount: bigint }>) {
  return claims.map((item) => ({ ...item, amount: item.amount.toString() }));
}

async function writeReport(report: object) {
  await mkdir("reports", { recursive: true });
  await writeFile("reports/phase3-cusdc-final.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function decrypt(handle: string, signer: Signer, label: string, records: RecordItem[]) {
  if (handle === ethers.ZeroHash) return 0n;
  const started = Date.now();
  const value = await fhevm.userDecryptEuint(FhevmType.euint64, handle, CUSDC_POOL, signer);
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
