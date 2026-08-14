"use client";

import { useState } from "react";
import { useConfidentialIsOperator, useConfidentialSetOperator, useGrantPermit, useShield, useZamaSDK } from "@zama-fhe/react-sdk";
import { parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { POOL_FAUCET_ADDRESS, SEPOLIA_CHAIN_ID } from "@/config/contracts";
import { useActivity } from "@/features/activity/activity-provider";
import { confidentialWrapperAbi, poolAbi } from "@/features/pool/abis";
import type { PoolAsset } from "@/features/pool/use-pool-assets";
import type { PoolState } from "@/features/pool/use-pool-state";
import { useI18n } from "@/i18n/i18n-provider";
import { toUserFacingError } from "@/shared/errors/user-facing-error";

type RevealedBalances = { principal?: bigint; winnings?: bigint };

export function usePoolActions(asset: PoolAsset, poolState: PoolState | undefined, refresh: () => Promise<unknown>) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const sdk = useZamaSDK();
  const { t } = useI18n();
  const activity = useActivity();
  const [revealed, setRevealed] = useState<RevealedBalances>({});
  const { writeContractAsync } = useWriteContract();
  const grantPermit = useGrantPermit();
  const shield = useShield({ address: asset.confidentialTokenAddress, optimistic: true });
  const setOperator = useConfidentialSetOperator(asset.confidentialTokenAddress);
  const operator = useConfidentialIsOperator({ address: asset.confidentialTokenAddress, holder: address, spender: asset.poolAddress });
  const rate = useReadContract({ address: asset.confidentialTokenAddress, abi: confidentialWrapperAbi, functionName: "rate", chainId: SEPOLIA_CHAIN_ID });

  async function transact(config: Parameters<typeof writeContractAsync>[0]) {
    const hash = await writeContractAsync(config);
    if (!publicClient) throw new Error("Sepolia client unavailable");
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async function run<T>(action: () => Promise<T>) {
    try { return await action() !== false; }
    catch (cause) {
      activity.fail();
      activity.notifyError(toUserFacingError(cause, t));
      return false;
    }
  }

  const getTokens = () => run(async () => {
    requireWallet(address);
    activity.begin({ title: t("operation.tokensTitle"), detail: t("operation.gaslessRequest"), step: 1, totalSteps: 1 });
    const response = await fetch("/api/faucet/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: address, tokenAddress: asset.tokenAddress }) });
    const payload = await response.json() as { hash?: Hex; code?: string };
    let hash: Hex;
    if (response.ok && payload.hash) {
      hash = payload.hash;
      if (!publicClient) throw new Error("Sepolia client unavailable");
      await publicClient.waitForTransactionReceipt({ hash });
    } else if (payload.code === "COOLDOWN") throw new Error("faucet cooldown");
    else if (payload.code === "TOKEN_UNAVAILABLE") throw new Error("faucet token unavailable");
    else throw new Error("faucet service unavailable");
    activity.progress(t("operation.gaslessConfirming"), 1);
    await refresh();
    activity.complete({ kind: "tokens", title: t("success.tokensTitle"), detail: t("success.tokensDetail"), txHash: hash, contractAddress: POOL_FAUCET_ADDRESS, assetSymbol: asset.symbol, assetIcon: asset.icon });
  });

  const wrap = (amount: string) => run(async () => {
    const confidentialUnits = parseAmount(amount);
    const publicUnits = confidentialUnits * (rate.data ?? BigInt(1));
    activity.begin({ title: t("operation.wrapTitle"), detail: t("operation.wrapApprove"), step: 1, totalSteps: 2 });
    const result = await shield.mutateAsync({
      amount: publicUnits,
      approvalStrategy: "exact",
      onApprovalSubmitted: () => activity.progress(t("operation.wrapCreate"), 2),
      onShieldSubmitted: () => activity.progress(t("operation.confirming"), 2),
    });
    await refresh();
    activity.complete({ kind: "wrap", title: t("success.wrapTitle"), detail: t("success.wrapDetail"), txHash: result.txHash, contractAddress: asset.confidentialTokenAddress, assetSymbol: asset.symbol, assetIcon: asset.icon });
  });

  const deposit = (amount: string) => run(async () => {
    requireWallet(address);
    const value = parseAmount(amount);
    const needsOperator = operator.data !== true;
    activity.begin({ title: t("operation.depositTitle"), detail: needsOperator ? t("operation.depositApprove") : t("operation.depositEncrypt"), step: 1, totalSteps: needsOperator ? 3 : 2 });
    if (needsOperator) {
      await setOperator.mutateAsync({ operator: asset.poolAddress, until: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 });
      activity.progress(t("operation.depositEncrypt"), 2);
    }
    const encrypted = await sdk.encrypt({ values: [{ value, type: "euint64" }], contractAddress: asset.poolAddress, userAddress: address });
    activity.progress(t("operation.confirming"), needsOperator ? 3 : 2);
    const hash = await transact({ address: asset.poolAddress, abi: poolAbi, functionName: "deposit", args: [encrypted.encryptedValues[0], encrypted.inputProof], gas: BigInt(2_500_000), chainId: SEPOLIA_CHAIN_ID });
    const encryptedAmountHandle = await activityAmountHandle(hash, "EncryptedDeposit");
    await Promise.all([refresh(), operator.refetch()]);
    setRevealed({});
    activity.complete({ kind: "deposit", title: t("success.depositTitle"), detail: t("success.depositDetail"), txHash: hash, contractAddress: asset.poolAddress, assetSymbol: asset.symbol, assetIcon: asset.icon, encryptedAmountHandle });
    return hash;
  });

  const withdraw = (amount: string) => run(async () => {
    requireWallet(address);
    const value = parseAmount(amount);
    const principal = revealed.principal ?? (await decryptBalances(false)).principal;
    if (principal === BigInt(0)) {
      activity.notifyInfo(t("pool.noPrincipalTitle"), t("pool.noPrincipalInfo"));
      return false;
    }
    if (value > principal) {
      activity.notifyInfo(t("pool.withdrawTooHighTitle"), t("pool.withdrawTooHighInfo"));
      return false;
    }
    activity.begin({ title: t("operation.withdrawTitle"), detail: t("operation.withdrawEncrypt"), step: 1, totalSteps: 2 });
    const encrypted = await sdk.encrypt({ values: [{ value, type: "euint64" }], contractAddress: asset.poolAddress, userAddress: address });
    activity.progress(t("operation.confirming"), 2);
    const hash = await transact({ address: asset.poolAddress, abi: poolAbi, functionName: "withdraw", args: [encrypted.encryptedValues[0], encrypted.inputProof], gas: BigInt(2_500_000), chainId: SEPOLIA_CHAIN_ID });
    const encryptedAmountHandle = await activityAmountHandle(hash, "EncryptedWithdrawal");
    await refresh();
    setRevealed({});
    activity.complete({ kind: "withdraw", title: t("success.withdrawTitle"), detail: t("success.withdrawDetail"), txHash: hash, contractAddress: asset.poolAddress, assetSymbol: asset.symbol, assetIcon: asset.icon, encryptedAmountHandle });
    return hash;
  });

  async function decryptBalances(showConfirmation: boolean): Promise<RevealedBalances & { principal: bigint; winnings: bigint }> {
    if (!poolState) throw new Error("Pool state unavailable");
    activity.begin({ title: t("operation.revealTitle"), detail: t("operation.revealSign"), step: 1, totalSteps: 2 });
    await grantPermit.mutateAsync([asset.poolAddress]);
    activity.progress(t("operation.revealDecrypt"), 2);
    const handles = [poolState.principalHandle, poolState.winningsHandle];
    const result = await sdk.decryption.decryptValues(handles.map((encryptedValue) => ({ encryptedValue, contractAddress: asset.poolAddress })));
    const principal = result[handles[0]];
    const winnings = result[handles[1]];
    if (principal === undefined || winnings === undefined) throw new Error("Private values unavailable");
    const balances = { principal: BigInt(principal), winnings: BigInt(winnings) };
    setRevealed(balances);
    activity.fail();
    if (showConfirmation) activity.notifySuccess(t("success.revealTitle"), t("success.revealDetail"));
    return balances;
  }

  const reveal = () => run(async () => { await decryptBalances(true); });

  async function prepareWithdraw() {
    return run(async () => {
      const principal = revealed.principal ?? (await decryptBalances(false)).principal;
      if (principal === BigInt(0)) {
        activity.notifyInfo(t("pool.noPrincipalTitle"), t("pool.noPrincipalInfo"));
        return false;
      }
    });
  }

  const hide = () => setRevealed({});

  const claim = () => run(async () => {
    const winnings = revealed.winnings ?? (await decryptBalances(false)).winnings;
    if (winnings === BigInt(0)) {
      activity.notifyInfo(t("pool.noWinningsTitle"), t("pool.noWinningsInfo"));
      return false;
    }
    activity.begin({ title: t("operation.claimTitle"), detail: t("operation.walletConfirm"), step: 1, totalSteps: 1 });
    const hash = await transact({ address: asset.poolAddress, abi: poolAbi, functionName: "claim", chainId: SEPOLIA_CHAIN_ID });
    const encryptedAmountHandle = await activityAmountHandle(hash, "EncryptedPrizeClaimed");
    await refresh();
    setRevealed((current) => ({ ...current, winnings: undefined }));
    activity.complete({ kind: "claim", title: t("success.claimTitle"), detail: t("success.claimDetail"), txHash: hash, contractAddress: asset.poolAddress, assetSymbol: asset.symbol, assetIcon: asset.icon, encryptedAmountHandle });
  });

  const advanceDraw = () => run(async () => {
    if (!poolState) throw new Error("Pool state unavailable");
    const state = poolState.lifecycle;
    activity.begin({ title: t("operation.drawTitle"), detail: drawStage(t, state), step: 1, totalSteps: 1 });
    if (state === 0) await transact({ address: asset.poolAddress, abi: poolAbi, functionName: "requestDraw", gas: BigInt(2_000_000), chainId: SEPOLIA_CHAIN_ID });
    else if (state === 1 || state === 3) {
      const functionName = state === 1 ? "totalWeightHandle" : "resultHandle";
      const handle = await publicClient!.readContract({ address: asset.poolAddress, abi: poolAbi, functionName });
      const decryption = await sdk.decryption.decryptPublicValues([handle]);
      await transact({ address: asset.poolAddress, abi: poolAbi, functionName: state === 1 ? "startSelection" : "finalizeSelection", args: [[handle], decryption.abiEncodedClearValues, decryption.decryptionProof], gas: state === 1 ? BigInt(3_500_000) : BigInt(2_500_000), chainId: SEPOLIA_CHAIN_ID });
    } else await transact({ address: asset.poolAddress, abi: poolAbi, functionName: state === 2 ? "processSelectionBatch" : "processNextDrawSyncBatch", args: [8], gas: BigInt(3_000_000), chainId: SEPOLIA_CHAIN_ID });
    await refresh();
    activity.fail();
    activity.notifySuccess(t("success.drawTitle"), t("success.drawDetail"));
  });

  return { getTokens, wrap, deposit, withdraw, prepareWithdraw, reveal, hide, claim, advanceDraw, revealed, isPending: Boolean(activity.pending) };

  async function activityAmountHandle(hash: Hex, eventName: "EncryptedDeposit" | "EncryptedWithdrawal" | "EncryptedPrizeClaimed") {
    if (!publicClient) return undefined;
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const [event] = parseEventLogs({ abi: poolAbi, logs: receipt.logs, eventName, strict: false });
    return event && "encryptedAmount" in event.args ? event.args.encryptedAmount as Hex : undefined;
  }
}

function parseAmount(value: string) {
  const amount = parseUnits(value.trim(), 6);
  if (amount <= BigInt(0)) throw new Error("Amount must be positive");
  return amount;
}

function requireWallet(address: Address | undefined): asserts address is Address {
  if (!address) throw new Error("Wallet not connected");
}

function drawStage(t: ReturnType<typeof useI18n>["t"], state: number) {
  return [t("draw.stageStart"), t("draw.stageTotal"), t("draw.stageSelect"), t("draw.stageResult"), t("draw.stageSync")][state] ?? t("operation.confirming");
}
