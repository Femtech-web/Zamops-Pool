"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useGrantPermit, useZamaSDK } from "@zama-fhe/react-sdk";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ExternalLink, Eye, EyeOff, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";

import { useActivity, type ActivityItem } from "@/features/activity/activity-provider";
import { EXPLORER, OperationFeedback } from "@/features/activity/operation-feedback";
import { AppHeader } from "@/features/shell/app-header";
import { useI18n } from "@/i18n/i18n-provider";
import { toUserFacingError } from "@/shared/errors/user-facing-error";
import { formatUnits } from "viem";

const PAGE_SIZE = 10;

export function ActivityWorkspace({ initialItemId }: { initialItemId?: string }) {
  const { isConnected } = useAccount();
  const { t } = useI18n();
  const { activities } = useActivity();
  const [page, setPage] = useState(1);
  const selected = activities.find((item) => item.id === initialItemId);
  const totalPages = Math.max(1, Math.ceil(activities.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = activities.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return <main className="pool-shell">
    <AppHeader />
    {!isConnected ? <ActivityWalletGate /> : <section className="activity-page" aria-labelledby="activity-page-title">
      <Link className="activity-back" href="/app"><ArrowLeft size={13} /> {t("activity.backToPool")}</Link>
      <header className="activity-page-header"><div><p className="eyebrow">{t("activity.kicker")}</p><h1 id="activity-page-title">{t("activity.pageTitle")}</h1><p>{t("activity.pageDescription")}</p></div></header>
      <section className="activity-ledger">
        {visible.length ? <ol>{visible.map((item) => <ActivityRow key={item.id} item={item} />)}</ol> : <p className="activity-page-empty">{t("activity.empty")}</p>}
        {activities.length > PAGE_SIZE ? <nav className="activity-pagination" aria-label={t("activity.pageTitle")}>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage === 1}><ArrowLeft size={13} /> {t("activity.previous")}</button>
          <span>{t("activity.page")} {safePage} / {totalPages}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={safePage === totalPages}>{t("activity.next")} <ArrowRight size={13} /></button>
        </nav> : null}
      </section>
      <p className="activity-privacy-note">{t("activity.privacyNote")}</p>
    </section>}
    {selected ? <ActivityDetails item={selected} /> : null}
    <OperationFeedback />
  </main>;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { t } = useI18n();
  return <li><Link href={`/app/activity?item=${item.id}`}>
    {item.assetIcon ? <Image src={item.assetIcon} alt="" width={34} height={34} /> : item.kind === "tokens" ? <span className="activity-kind-icon activity-kind-icon--tokens" aria-hidden="true"><ArrowDownToLine size={14} /></span> : <span className="activity-token-placeholder" />}
    <div><strong>{item.title}</strong><p>{item.assetSymbol ?? t("activity.action")}</p></div>
    <time dateTime={new Date(item.timestamp).toISOString()}>{formatDate(item.timestamp)}</time>
    <span className="activity-status"><Check size={11} /> {t("activity.confirmed")}</span>
    <ArrowRight className="activity-row-arrow" size={14} aria-hidden="true" />
  </Link></li>;
}

function ActivityDetails({ item }: { item: ActivityItem }) {
  const { t } = useI18n();
  const sdk = useZamaSDK();
  const grantPermit = useGrantPermit();
  const activity = useActivity();
  const [amount, setAmount] = useState<bigint>();
  const [decrypting, setDecrypting] = useState(false);

  async function revealAmount() {
    if (!item.encryptedAmountHandle || !item.contractAddress) return;
    setDecrypting(true);
    try {
      await grantPermit.mutateAsync([item.contractAddress]);
      const result = await sdk.decryption.decryptValues([{ encryptedValue: item.encryptedAmountHandle, contractAddress: item.contractAddress }]);
      const clear = result[item.encryptedAmountHandle];
      if (clear === undefined) throw new Error("Private values unavailable");
      setAmount(BigInt(clear));
    } catch (cause) {
      activity.notifyError(toUserFacingError(cause, t));
    } finally { setDecrypting(false); }
  }
  return <div className="activity-detail-backdrop" role="presentation">
    <section className="activity-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title">
      <Link className="dialog-close" href="/app/activity" aria-label={t("common.close")}><X size={16} /></Link>
      <div className="activity-detail-heading">
        {item.assetIcon ? <Image src={item.assetIcon} alt="" width={42} height={42} /> : null}
        <div><p className="eyebrow">{t("activity.confirmed")}</p><h2 id="activity-detail-title">{item.title}</h2><p>{formatDate(item.timestamp)}</p></div>
      </div>
      <p className="activity-detail-copy">{item.detail}</p>
      <dl>
        <Detail label={t("activity.action")} value={activityLabel(t, item.kind)} />
        {item.assetSymbol ? <Detail label={t("activity.asset")} value={item.assetSymbol} /> : null}
        {item.walletAddress ? <Detail label={t("activity.wallet")} value={shortAddress(item.walletAddress)} mono /> : null}
        {item.contractAddress ? <Detail label={t("activity.contract")} value={shortAddress(item.contractAddress)} mono /> : null}
        {item.txHash ? <Detail label={t("activity.transaction")} value={shortAddress(item.txHash)} mono /> : null}
      </dl>
      {item.encryptedAmountHandle ? <div className="activity-private-amount"><div><span>{t("activity.privateAmount")}</span><strong>{amount === undefined ? "••••••" : `${formatUnits(amount, 6)} ${item.assetSymbol ?? ""}`}</strong></div><button type="button" onClick={() => amount === undefined ? void revealAmount() : setAmount(undefined)} disabled={decrypting}>{amount === undefined ? <Eye size={13} /> : <EyeOff size={13} />}{decrypting ? t("activity.revealing") : amount === undefined ? t("activity.revealAmount") : t("activity.hideAmount")}</button></div> : null}
      <p className="activity-amount-note">{item.encryptedAmountHandle ? t("activity.amountDecryptable") : t("activity.amountPrivate")}</p>
      {item.txHash ? <a className="activity-explorer" href={`${EXPLORER}${item.txHash}`} target="_blank" rel="noreferrer">{t("activity.viewTransaction")} <ExternalLink size={12} /></a> : null}
    </section>
  </div>;
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? "mono" : undefined}>{value}</dd></div>;
}

function ActivityWalletGate() {
  const { t } = useI18n();
  return <section className="wallet-gate" aria-labelledby="activity-wallet-title"><div className="empty-pool-mark" aria-hidden="true"><span /><i /></div><h1 id="activity-wallet-title">{t("walletGate.title")}</h1><p>{t("activity.pageDescription")}</p><ConnectButton.Custom>{({ openConnectModal }) => <button type="button" onClick={openConnectModal}>{t("wallet.connect")}</button>}</ConnectButton.Custom></section>;
}

function activityLabel(t: ReturnType<typeof useI18n>["t"], kind: ActivityItem["kind"]) {
  return t(`activity.kind.${kind}`);
}
function formatDate(timestamp: number) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp); }
function shortAddress(value: string) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
