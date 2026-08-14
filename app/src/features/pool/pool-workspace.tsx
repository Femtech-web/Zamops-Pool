"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

import { ActivityView, OperationFeedback } from "@/features/activity/operation-feedback";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { AppHeader } from "@/features/shell/app-header";
import { usePoolActions } from "@/features/pool/use-pool-actions";
import { usePoolAssets, type PoolAsset } from "@/features/pool/use-pool-assets";
import { usePoolPrizeStatus, type PoolPrizeStatus } from "@/features/pool/use-pool-prize-status";
import { usePoolState } from "@/features/pool/use-pool-state";
import { useI18n } from "@/i18n/i18n-provider";
import { useDialogA11y } from "@/shared/hooks/use-dialog-a11y";

type ActionMode = "deposit" | "wrap" | "withdraw" | null;
const FALLBACK_DELAY_SECONDS = 20 * 60;

export function PoolWorkspace() {
  const { isConnected } = useAccount();
  return <main className="pool-shell" id="main-content" tabIndex={-1}><AppHeader />{isConnected ? <ConnectedWorkspace /> : <WalletGate />}<OperationFeedback /></main>;
}

function ConnectedWorkspace() {
  const { t } = useI18n();
  const { address } = useAccount();
  const { assets, isLoading, error } = usePoolAssets();
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const defaultAsset = assets.find((item) => item.symbol === "cUSDC") ?? assets[0];
  const asset = assets.find((item) => item.confidentialTokenAddress === selectedAddress) ?? defaultAsset;

  if (isLoading) return <WorkspaceSkeleton label={t("pool.loading")} />;
  if (error || !address) return <QuietState title={t("pool.unavailableTitle")} body={t("pool.unavailableBody")} />;
  if (!asset) return <QuietState title={t("pool.noPoolsTitle")} body={t("pool.noPoolsBody")} />;

  return <PoolDashboard key={`${asset.poolAddress}:${address.toLowerCase()}`} asset={asset} assets={assets} account={address} onSelect={setSelectedAddress} />;
}

function PoolDashboard({ asset, assets, account, onSelect }: { asset: PoolAsset; assets: PoolAsset[]; account: `0x${string}`; onSelect: (address: string) => void }) {
  const { t } = useI18n();
  const pool = usePoolState(asset.poolAddress, account);
  const prize = usePoolPrizeStatus(asset.poolAddress);
  const actions = usePoolActions(asset, pool.data, pool.refetch);
  const [mode, setMode] = useState<ActionMode>(null);
  const actionDialogRef = useRef<HTMLElement>(null);
  const [amount, setAmount] = useState("");
  const now = useCurrentTimestamp();
  const principal = actions.revealed.principal;
  const winnings = actions.revealed.winnings;
  const balancesVisible = principal !== undefined && winnings !== undefined;
  const drawReady = pool.data ? now >= pool.data.nextDrawAt : false;
  const fallbackAt = pool.data ? pool.data.nextDrawAt + FALLBACK_DELAY_SECONDS : 0;
  const fallbackAvailable = Boolean(pool.data && pool.data.participantCount > 0 && now >= fallbackAt);
  useDialogA11y(actionDialogRef, mode !== null, () => setMode(null));

  function chooseMode(next: ActionMode) { setAmount(""); setMode(next); }
  async function chooseWithdraw() {
    if (await actions.prepareWithdraw()) chooseMode("withdraw");
  }
  async function submit() {
    const completed = mode === "deposit" ? await actions.deposit(amount) : mode === "wrap" ? await actions.wrap(amount) : await actions.withdraw(amount);
    if (completed) setMode(null);
  }

  return <section className="pool-workspace" id="pool">
    <header className="workspace-intro">
      <div><p className="eyebrow">{t("pool.eyebrow")}</p><h1>{t("nav.pool")}</h1><p>{t("pool.description")}</p></div>
      <PoolPicker asset={asset} assets={assets} onSelect={onSelect} />
    </header>

    <section className="pool-identity">
      <div className="token-icon"><Image src={asset.icon} alt="" width={38} height={38} /></div>
      <div><strong>{asset.symbol} {t("pool.poolSuffix")}</strong><p>{asset.name}</p></div>
      <button type="button" onClick={() => void actions.getTokens()} disabled={actions.isPending}>{t("pool.getTokens")}</button>
      <button type="button" onClick={() => chooseMode("wrap")} disabled={actions.isPending}>{t("pool.makePrivate")}</button>
    </section>

    <section className="balance-privacy">
      <div><strong>{t("pool.privateBalances")}</strong><p>{balancesVisible ? t("pool.balancesVisible") : t("pool.balancesHidden")}</p></div>
      <button type="button" onClick={() => balancesVisible ? actions.hide() : void actions.reveal()} disabled={actions.isPending}>{balancesVisible ? <EyeOff size={13} /> : <Eye size={13} />}{balancesVisible ? t("pool.hide") : t("pool.revealBalances")}</button>
    </section>

    <section className="pool-overview">
      <article className="savings-card">
        <header><span>{t("pool.principal")}</span><small>{t("pool.principalHint")}</small></header>
        <strong>{principal === undefined ? "••••••" : formatUnits(principal, 6)} <small>{asset.symbol}</small></strong>
        <div className="savings-actions"><button type="button" onClick={() => void chooseWithdraw()} disabled={actions.isPending || principal === BigInt(0)}>{t("pool.withdraw")}</button></div>
      </article>
      <article className="winnings-card">
        <header><span>{t("pool.winnings")}</span><small>{t("pool.winningsHint")}</small></header>
        <strong>{winnings === undefined ? "••••••" : formatUnits(winnings, 6)} <small>{asset.symbol}</small></strong>
        <div className="winnings-actions"><button type="button" onClick={() => void actions.claim()} disabled={actions.isPending || winnings === BigInt(0)}>{t("pool.claim")}</button></div>
      </article>
    </section>

    <button className="primary-pool-action" type="button" onClick={() => chooseMode("deposit")} disabled={actions.isPending || pool.data?.lifecycle !== 0}>{pool.data?.lifecycle === 0 ? t("pool.deposit") : t("pool.depositsPaused")}</button>

    {mode ? <div className="action-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMode(null)}>
      <section ref={actionDialogRef} className="action-sheet" role="dialog" aria-modal="true" aria-labelledby="action-title">
        <header><div><p className="eyebrow">{actionKicker(t, mode)}</p><h2 id="action-title">{actionTitle(t, mode)}</h2></div><button type="button" onClick={() => setMode(null)} aria-label={t("common.close")}>×</button></header>
        <p>{actionBody(t, mode, asset.symbol)}</p>
        <label><span>{t("action.amount")}</span><div><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /><small>{asset.symbol}</small></div></label>
        <button className="action-submit" type="button" onClick={() => void submit()} disabled={!amount || actions.isPending}>{actionButton(t, mode)}</button>
      </section>
    </div> : null}

    <section className="current-draw" id="draw">
      <div className="draw-copy"><p className="eyebrow">{t("pool.progressTitle")}</p><h2>#{pool.data?.drawId ?? "—"}</h2><span>{drawStatus(t, pool.data?.lifecycle)}</span></div>
      <dl><div><dt>{drawReady ? t("pool.drawReady") : t("pool.nextDraw")}</dt><dd>{pool.data ? drawTime(pool.data.nextDrawAt, drawReady) : "—"}</dd></div><div><dt>{t("pool.totalSavers")}</dt><dd>{pool.data?.participantCount ?? "—"}</dd></div></dl>
      <div className="draw-state">
        <PrizeReadout t={t} lifecycle={pool.data?.lifecycle} status={prize.data} symbol={asset.symbol} />
        <AutomationReadout t={t} lifecycle={pool.data?.lifecycle} participantCount={pool.data?.participantCount} drawReady={drawReady} fallbackAvailable={fallbackAvailable} fallbackAt={fallbackAt} now={now} />
        {fallbackAvailable ? <button type="button" onClick={() => void actions.advanceDraw()} disabled={actions.isPending}>{t("draw.helpAdvance")}</button> : null}
      </div>
    </section>

    <p className="combined-total-note">{combinedTotalCopy(t, pool.data?.lifecycle, prize.data, asset.symbol)}</p>

    <ActivityView />
  </section>;
}

function WalletGate() {
  const { t } = useI18n();
  return <section className="wallet-gate" aria-labelledby="wallet-gate-title"><div className="empty-pool-mark" aria-hidden="true"><span /><i /></div><h1 id="wallet-gate-title">{t("walletGate.title")}</h1><p>{t("walletGate.body")}</p><ConnectButton.Custom>{({ openConnectModal }) => <button type="button" onClick={openConnectModal}>{t("wallet.connect")}</button>}</ConnectButton.Custom></section>;
}

function PoolPicker({ asset, assets, onSelect }: { asset: PoolAsset; assets: PoolAsset[]; onSelect: (address: string) => void }) {
  const { t } = useI18n();
  return <div className="pool-picker"><span>{t("pool.choosePool")}</span><details>
    <summary><Image src={asset.icon} alt="" width={25} height={25} /><span><strong>{asset.symbol}</strong><small>{asset.name}</small></span><i aria-hidden="true">⌄</i></summary>
    <div className="pool-picker-menu">{assets.map((item) => <button key={item.poolAddress} type="button" aria-current={item.poolAddress === asset.poolAddress ? "true" : undefined} onClick={(event) => { onSelect(item.confidentialTokenAddress); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Image src={item.icon} alt="" width={28} height={28} /><span><strong>{item.symbol}</strong><small>{item.name}</small></span>{item.poolAddress === asset.poolAddress ? <i aria-hidden="true">✓</i> : null}</button>)}</div>
  </details></div>;
}

function QuietState({ title, body }: { title: string; body: string }) { return <section className="wallet-gate"><div className="empty-pool-mark" aria-hidden="true"><span /><i /></div><h1>{title}</h1><p>{body}</p></section>; }
type T = ReturnType<typeof useI18n>["t"];
function actionKicker(t: T, mode: Exclude<ActionMode, null>) { return mode === "wrap" ? t("action.wrapKicker") : t("action.poolKicker"); }
function actionTitle(t: T, mode: Exclude<ActionMode, null>) { return mode === "deposit" ? t("action.depositTitle") : mode === "wrap" ? t("action.wrapTitle") : t("action.withdrawTitle"); }
function actionBody(t: T, mode: Exclude<ActionMode, null>, symbol: string) { return `${mode === "deposit" ? t("action.depositBody") : mode === "wrap" ? t("action.wrapBody") : t("action.withdrawBody")} ${symbol}.`; }
function actionButton(t: T, mode: Exclude<ActionMode, null>) { return mode === "deposit" ? t("action.depositButton") : mode === "wrap" ? t("action.wrapButton") : t("action.withdrawButton"); }
function drawStatus(t: T, state?: number) { return [t("draw.open"), t("draw.verifyingTotal"), t("draw.selecting"), t("draw.verifyingResult"), t("draw.preparing")][state ?? -1] ?? t("draw.loading"); }
function AutomationReadout({ t, lifecycle, participantCount, drawReady, fallbackAvailable, fallbackAt, now }: { t: T; lifecycle?: number; participantCount?: number; drawReady: boolean; fallbackAvailable: boolean; fallbackAt: number; now: number }) {
  let label = t("draw.automationScheduled");
  let detail = t("draw.automationTiming");
  if (participantCount === 0) {
    label = t("draw.automationWaitingSaver");
    detail = t("draw.automationWaitingSaverDetail");
  } else if (fallbackAvailable) {
    label = t("draw.fallbackReady");
    detail = t("draw.fallbackReadyDetail");
  } else if (drawReady || (lifecycle !== undefined && lifecycle !== 0)) {
    label = t("draw.automationWorking");
    detail = `${t("draw.fallbackUnlocks")} ${duration(Math.max(0, fallbackAt - now))}.`;
  }
  return <div className="automation-readout" role="status"><strong>{label}</strong><p>{detail}</p></div>;
}
function PrizeReadout({ t, lifecycle, status, symbol }: { t: T; lifecycle?: number; status?: PoolPrizeStatus | null; symbol: string }) {
  const label = lifecycle === undefined || status === undefined
    ? t("draw.prizeChecking")
    : lifecycle === 0
      ? status?.currentPrizeFunded ? t("draw.prizeFunded") : t("draw.prizeAwaiting")
      : lifecycle === 4
        ? t("draw.prizeAwarded")
        : t("draw.prizeLocked");
  const detail = lifecycle === 0 && status?.currentPrizeFunded
    ? t("draw.prizeFundedDetail")
    : lifecycle === 0
      ? t("draw.prizeAwaitingDetail")
      : `${t("draw.prizePrivateDetail")} ${symbol}.`;
  return <div className="prize-readout"><span aria-hidden="true" /><div><strong>{label}</strong><p>{detail}</p></div></div>;
}
function combinedTotalCopy(t: T, lifecycle: number | undefined, status: PoolPrizeStatus | null | undefined, symbol: string) {
  if (lifecycle !== undefined && lifecycle >= 2 && status?.revealedTotalWeight !== undefined) return `${t("draw.combinedTotal")}: ${formatUnits(status.revealedTotalWeight, 6)} ${symbol}. ${t("draw.combinedPublicOnly")}`;
  if (lifecycle === 1) return t("draw.combinedVerifying");
  return t("draw.combinedPrivate");
}
function drawTime(timestamp: number, ready: boolean) {
  if (ready) return "00:00:00";
  const seconds = Math.max(0, timestamp - Math.floor(Date.now() / 1_000));
  return duration(seconds);
}
function duration(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}
function useCurrentTimestamp() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
