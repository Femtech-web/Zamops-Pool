import { FhevmType } from "@fhevm/hardhat-plugin";
import { ethers, fhevm, network } from "hardhat";

import {
  ConfidentialPrizePool__factory,
  IConfidentialTokenWrapper__factory,
  IERC20Metadata__factory,
  ZamOpsPoolFactory__factory,
  ZamOpsPoolFaucet__factory,
} from "../typechain-types";

const SEPOLIA_CHAIN_ID = 11_155_111n;
const CUSDC = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const DEFAULT_FACTORY = "0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2";
const DEFAULT_FAUCET = "0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F";
const DEPOSIT_AMOUNT = 10_000_000n;
const MAX_EXPIRY = 281_474_976_710_655n;

async function mine(label: string, pending: ReturnType<ReturnType<typeof ConfidentialPrizePool__factory.connect>["deposit"]>) {
  const transaction = await pending;
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${label} was not mined`);
  console.info(`${label}: ${transaction.hash}`);
}

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (network.name !== "sepolia" || chain.chainId !== SEPOLIA_CHAIN_ID) throw new Error("cUSDC preparation is Sepolia-only");
  await fhevm.initializeCLIApi();
  const [saver] = await ethers.getSigners();
  if (!saver) throw new Error("A Sepolia saver key is required");

  const factory = ZamOpsPoolFactory__factory.connect(process.env.KEEPER_FACTORY_ADDRESS || DEFAULT_FACTORY, saver);
  const poolAddress = await factory.poolByAsset(CUSDC);
  if (poolAddress === ethers.ZeroAddress) throw new Error("The canonical cUSDC pool is missing");
  const pool = ConfidentialPrizePool__factory.connect(poolAddress, saver);
  const principalHandle = await pool.encryptedPrincipalOf(saver.address);
  const principal = principalHandle === ethers.ZeroHash
    ? 0n
    : await fhevm.userDecryptEuint(FhevmType.euint64, principalHandle, poolAddress, saver);
  if (principal > 0n) {
    console.info(JSON.stringify({ status: "already-active", pool: poolAddress, saver: saver.address, principal: principal.toString() }, null, 2));
    return;
  }

  const wrapper = IConfidentialTokenWrapper__factory.connect(CUSDC, saver);
  const underlyingAddress = await wrapper.underlying();
  const underlying = IERC20Metadata__factory.connect(underlyingAddress, saver);
  const confidentialHandle = await wrapper.confidentialBalanceOf(saver.address);
  const confidentialBalance = confidentialHandle === ethers.ZeroHash
    ? 0n
    : await fhevm.userDecryptEuint(FhevmType.euint64, confidentialHandle, CUSDC, saver);
  if (confidentialBalance < DEPOSIT_AMOUNT) {
    const publicAmount = (DEPOSIT_AMOUNT - confidentialBalance) * (await wrapper.rate());
    if ((await underlying.balanceOf(saver.address)) < publicAmount) {
      const faucet = ZamOpsPoolFaucet__factory.connect(process.env.KEEPER_FAUCET_ADDRESS || DEFAULT_FAUCET, saver);
      await mine("claim cUSDC test tokens", faucet.claim(underlyingAddress));
    }
    await mine("approve cUSDC wrapper", underlying.approve(CUSDC, publicAmount));
    await mine("shield cUSDC", wrapper.wrap(saver.address, publicAmount));
  }
  if (!(await wrapper.isOperator(saver.address, poolAddress))) await mine("approve cUSDC pool", wrapper.setOperator(poolAddress, MAX_EXPIRY));
  const encrypted = await fhevm.createEncryptedInput(poolAddress, saver.address).add64(DEPOSIT_AMOUNT).encrypt();
  await mine("deposit private cUSDC savings", pool.deposit(encrypted.handles[0], encrypted.inputProof, { gasLimit: 2_500_000 }));
  console.info(JSON.stringify({ status: "prepared", pool: poolAddress, saver: saver.address, principal: DEPOSIT_AMOUNT.toString() }, null, 2));
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
