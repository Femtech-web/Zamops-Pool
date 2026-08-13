"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useGrantPermit, usePendingUnshield, useResumeUnshield, useShield, useUnshield, useZamaSDK } from "@zama-fhe/react-sdk";
import { Eye, EyeOff, RotateCcw, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContracts } from "wagmi";

import { useActivity } from "@/features/activity/activity-provider";
import { OperationFeedback } from "@/features/activity/operation-feedback";
import { POOL_FAUCET_ADDRESS, SEPOLIA_CHAIN_ID } from "@/config/contracts";
import { erc20Abi, confidentialWrapperAbi } from "@/features/pool/abis";
import { usePoolAssets, type PoolAsset } from "@/features/pool/use-pool-assets";
import { AppHeader } from "@/features/shell/app-header";
import { useI18n } from "@/i18n/i18n-provider";
import { toUserFacingError } from "@/shared/errors/user-facing-error";

type TokenAction = "wrap" | "unwrap" | null;

export function TokensWorkspace() {
  const { isConnected, address } = useAccount();
  const { assets, isLoading, error } = usePoolAssets();
  return <main className="pool-shell">
    <AppHeader />
    {!isConnected || !address ? <TokensWalletGate /> : <TokensPortfolio assets={assets} account={address} isLoading={isLoading} error={error} />}
    <OperationFeedback />
  </main>;
}

function TokensPortfolio({ assets, account, isLoading, error }: { assets: PoolAsset[]; account: Address; isLoading: boolean; error: Error | null }) {
  const { t } = useI18n();
  if (isLoading) return <section className="pool-loading" role="status"><span /><p>{t("tokens.loading")}</p></section>;
  if (error) return <section className="wallet-gate"><h1>{t("tokens.unavailableTitle")}</h1><p>{t("tokens.unavailableBody")}</p></section>;
  return <section className="tokens-page" aria-labelledby="tokens-title">
    <header className="tokens-heading"><p className="eyebrow">{t("tokens.kicker")}</p><h1 id="tokens-title">{t("tokens.title")}</h1><p>{t("tokens.description")}</p></header>
    <div className="tokens-list">{assets.map((asset) => <TokenRow key={asset.confidentialTokenAddress} asset={asset} account={account} />)}</div>
    <p className="tokens-note">{t("tokens.note")}</p>
  </section>;
}

function TokenRow({ asset, account }: { asset: PoolAsset; account: Address }) {
  const { t } = useI18n();
  const sdk = useZamaSDK();
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const activity = useActivity();
  const grantPermit = useGrantPermit();
  const shield = useShield({ address: asset.confidentialTokenAddress, optimistic: true });
  const unshield = useUnshield(asset.confidentialTokenAddress);
  const pendingUnshield = usePendingUnshield(asset.confidentialTokenAddress);
  const resumeUnshield = useResumeUnshield(asset.confidentialTokenAddress);
  const [privateBalance, setPrivateBalance] = useState<bigint>();
  const [action, setAction] = useState<TokenAction>(null);
  const [amount, setAmount] = useState("");
  const reads = useReadContracts({ contracts: [
    { address: asset.tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [account] },
    { address: asset.tokenAddress, abi: erc20Abi, functionName: "decimals" },
    { address: asset.confidentialTokenAddress, abi: confidentialWrapperAbi, functionName: "rate" },
    { address: asset.confidentialTokenAddress, abi: confidentialWrapperAbi, functionName: "confidentialBalanceOf", args: [account] },
  ] });
  const publicBalance = reads.data?.[0]?.status === "success" ? reads.data[0].result : undefined;
  const publicDecimals = reads.data?.[1]?.status === "success" ? Number(reads.data[1].result) : 6;
  const rate = reads.data?.[2]?.status === "success" ? reads.data[2].result : BigInt(1);
  const privateHandle = reads.data?.[3]?.status === "success" ? reads.data[3].result : undefined;

  function openAction(nextAction: Exclude<TokenAction, null>) {
    setAmount("");
    setAction(nextAction);
  }

  function closeAction() {
    setAmount("");
    setAction(null);
  }

  async function run(work: () => Promise<void>) {
    try { await work(); }
    catch (cause) { activity.fail(); activity.notifyError(toUserFacingError(cause, t)); }
  }

  async function reveal() {
    await run(async () => {
      if (!privateHandle) throw new Error("Private values unavailable");
      activity.begin({ title: t("operation.revealTitle"), detail: t("operation.revealSign"), step: 1, totalSteps: 2 });
      await grantPermit.mutateAsync([asset.confidentialTokenAddress]);
      activity.progress(t("operation.revealDecrypt"), 2);
      const values = await sdk.decryption.decryptValues([{ encryptedValue: privateHandle, contractAddress: asset.confidentialTokenAddress }]);
      const value = values[privateHandle];
      if (value === undefined) throw new Error("Private values unavailable");
      setPrivateBalance(BigInt(value));
      activity.fail();
      activity.notifySuccess(t("tokens.balanceRevealed"), t("tokens.balanceRevealedBody"));
    });
  }

  async function getTokens() {
    await run(async () => {
      activity.begin({ title: t("operation.tokensTitle"), detail: t("operation.gaslessRequest"), step: 1, totalSteps: 1 });
      const response = await fetch("/api/faucet/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account, tokenAddress: asset.tokenAddress }) });
      const payload = await response.json() as { hash?: Hex; code?: string };
      if (!response.ok || !payload.hash) {
        if (payload.code === "COOLDOWN") throw new Error("faucet cooldown");
        if (payload.code === "TOKEN_UNAVAILABLE") throw new Error("faucet token unavailable");
        throw new Error("faucet service unavailable");
      }
      activity.progress(t("operation.gaslessConfirming"), 1);
      if (!publicClient) throw new Error("Sepolia client unavailable");
      await publicClient.waitForTransactionReceipt({ hash: payload.hash });
      await reads.refetch();
      activity.complete({ kind: "tokens", title: t("success.tokensTitle"), detail: t("success.tokensDetail"), txHash: payload.hash, contractAddress: POOL_FAUCET_ADDRESS, assetSymbol: asset.symbol, assetIcon: asset.icon });
    });
  }

  async function submit() {
    await run(async () => {
      const confidentialUnits = parsePositive(amount);
      if (action === "wrap") {
        activity.begin({ title: t("operation.wrapTitle"), detail: t("operation.wrapApprove"), step: 1, totalSteps: 2 });
        const result = await shield.mutateAsync({ amount: confidentialUnits * rate, approvalStrategy: "exact", onApprovalSubmitted: () => activity.progress(t("operation.wrapCreate"), 2), onShieldSubmitted: () => activity.progress(t("operation.confirming"), 2) });
        await reads.refetch();
        setPrivateBalance(undefined);
        closeAction();
        activity.complete({ kind: "wrap", title: t("success.wrapTitle"), detail: t("success.wrapDetail"), txHash: result.txHash, contractAddress: asset.confidentialTokenAddress, assetSymbol: asset.symbol, assetIcon: asset.icon });
      } else {
        activity.begin({ title: t("tokens.unshielding"), detail: t("tokens.unwrapRequest"), step: 1, totalSteps: 2 });
        const result = await unshield.mutateAsync({ amount: confidentialUnits, onUnwrapSubmitted: () => activity.progress(t("tokens.unwrapFinalize"), 2), onFinalizing: () => activity.progress(t("tokens.unwrapFinalize"), 2) });
        await reads.refetch();
        setPrivateBalance(undefined);
        closeAction();
        activity.complete({ kind: "unwrap", title: t("tokens.unwrapSuccess"), detail: t("tokens.unwrapSuccessBody"), txHash: result.txHash, contractAddress: asset.confidentialTokenAddress, assetSymbol: asset.symbol, assetIcon: asset.icon });
      }
    });
  }

  async function resume() {
    const unwrapTxHash = pendingUnshield.data;
    if (!unwrapTxHash) return;
    await run(async () => {
      activity.begin({ title: t("tokens.resumeTitle"), detail: t("tokens.unwrapFinalize"), step: 1, totalSteps: 1 });
      const result = await resumeUnshield.mutateAsync({ unwrapTxHash });
      await reads.refetch();
      activity.complete({ kind: "unwrap", title: t("tokens.unwrapSuccess"), detail: t("tokens.unwrapSuccessBody"), txHash: result.txHash, contractAddress: asset.confidentialTokenAddress, assetSymbol: asset.symbol, assetIcon: asset.icon });
    });
  }

  return <article className="token-row">
    <div className="token-row-identity"><Image src={asset.icon} alt="" width={38} height={38} /><div><strong>{asset.publicSymbol} <span>/ {asset.symbol}</span></strong><p>{asset.name}</p></div></div>
    <div className="token-balance"><span>{t("tokens.publicBalance")}</span><strong>{publicBalance === undefined ? "—" : formatUnits(publicBalance, publicDecimals)} <small>{asset.publicSymbol}</small></strong></div>
    <div className="token-balance private"><span>{t("tokens.privateBalance")}</span><strong>{privateBalance === undefined ? "••••••" : formatUnits(privateBalance, 6)} <small>{asset.symbol}</small></strong><button type="button" onClick={() => privateBalance === undefined ? void reveal() : setPrivateBalance(undefined)}>{privateBalance === undefined ? <Eye size={12} /> : <EyeOff size={12} />}{privateBalance === undefined ? t("tokens.reveal") : t("tokens.hide")}</button></div>
    <div className="token-row-actions"><button type="button" onClick={() => void getTokens()}>{t("pool.getTokens")}</button><button type="button" onClick={() => openAction("wrap")}>{t("tokens.makePrivate")}</button><button type="button" onClick={() => openAction("unwrap")}>{t("tokens.makePublic")}</button>{pendingUnshield.data ? <button className="resume" type="button" onClick={() => void resume()}><RotateCcw size={12} /> {t("tokens.resume")}</button> : null}</div>
    {action ? <div className="action-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeAction()}><section className="action-sheet" role="dialog" aria-modal="true" aria-labelledby={`token-action-${asset.symbol}`}><header><div><p className="eyebrow">{t("tokens.kicker")}</p><h2 id={`token-action-${asset.symbol}`}>{action === "wrap" ? t("tokens.makePrivate") : t("tokens.makePublic")}</h2></div><button type="button" onClick={closeAction} aria-label={t("common.close")}><X size={17} /></button></header><p>{action === "wrap" ? t("tokens.wrapBody") : t("tokens.unwrapBody")}</p><label><span>{t("action.amount")}</span><div><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /><small>{action === "wrap" ? asset.publicSymbol : asset.symbol}</small></div></label><button className="action-submit" type="button" onClick={() => void submit()} disabled={!amount}>{action === "wrap" ? t("tokens.makePrivate") : t("tokens.makePublic")}</button></section></div> : null}
  </article>;
}

function TokensWalletGate() {
  const { t } = useI18n();
  return <section className="wallet-gate" aria-labelledby="tokens-wallet-title"><div className="empty-pool-mark" aria-hidden="true"><span /><i /></div><h1 id="tokens-wallet-title">{t("walletGate.title")}</h1><p>{t("tokens.connectBody")}</p><ConnectButton.Custom>{({ openConnectModal }) => <button type="button" onClick={openConnectModal}>{t("wallet.connect")}</button>}</ConnectButton.Custom></section>;
}

function parsePositive(value: string) { const amount = parseUnits(value.trim(), 6); if (amount <= BigInt(0)) throw new Error("Amount must be positive"); return amount; }
