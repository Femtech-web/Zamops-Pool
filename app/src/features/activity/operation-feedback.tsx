"use client";

import { ArrowDownToLine, ArrowRight, Check, ExternalLink, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { useActivity } from "@/features/activity/activity-provider";
import { useI18n } from "@/i18n/i18n-provider";

const EXPLORER = "https://sepolia.etherscan.io/tx/";

export function OperationFeedback() {
  const { pending, success, successToast, errorToast, dismissError, dismissSuccess, dismissSuccessToast } = useActivity();
  const { t } = useI18n();
  return <>
    {pending ? <aside className="operation-pending" role="status" aria-live="polite">
      <span className="operation-spinner" aria-hidden="true" />
      <div><strong>{pending.title}</strong><p>{pending.detail}</p></div>
      {pending.totalSteps > 1 ? <small>{pending.step}/{pending.totalSteps}</small> : null}
    </aside> : null}
    {errorToast ? <aside className="error-toast" role="alert" aria-live="assertive">
      <span aria-hidden="true">!</span><p>{errorToast.message}</p>
      <button type="button" onClick={dismissError} aria-label={t("common.close")}><X size={14} /></button>
    </aside> : null}
    {successToast ? <aside className="success-toast" role="status" aria-live="polite">
      <span aria-hidden="true"><Check size={13} strokeWidth={2.5} /></span>
      <div><strong>{successToast.title}</strong><p>{successToast.message}</p></div>
      <button type="button" onClick={dismissSuccessToast} aria-label={t("common.close")}><X size={14} /></button>
    </aside> : null}
    {success ? <div className="success-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && dismissSuccess()}>
      <section className="success-dialog" role="dialog" aria-modal="true" aria-labelledby="success-title">
        <button className="dialog-close" type="button" onClick={dismissSuccess} aria-label={t("common.close")}><X size={16} /></button>
        <span className="success-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">{t("success.kicker")}</p>
        <h2 id="success-title">{success.title}</h2>
        <p>{success.detail}</p>
        {success.txHash ? <a href={`${EXPLORER}${success.txHash}`} target="_blank" rel="noreferrer">{t("activity.viewTransaction")} <ExternalLink size={12} /></a> : null}
        <button className="dialog-done" type="button" onClick={dismissSuccess}>{t("common.done")}</button>
      </section>
    </div> : null}
  </>;
}

export function ActivityView() {
  const { activities } = useActivity();
  const { t } = useI18n();
  const recent = activities.slice(0, 5);
  return <section className="activity-view" aria-labelledby="activity-title">
    <header><div><p className="eyebrow">{t("activity.kicker")}</p><h2 id="activity-title">{t("activity.title")}</h2></div>{activities.length ? <Link href="/app/activity">{t("activity.viewAll")} <ArrowRight size={13} /></Link> : null}</header>
    {recent.length ? <ol>{recent.map((item) => <li key={item.id}>
      <Link className="activity-row-link" href={`/app/activity?item=${item.id}`} aria-label={`${item.title}. ${t("activity.viewDetails")}`}>
        {item.assetIcon ? <Image src={item.assetIcon} alt="" width={28} height={28} /> : item.kind === "tokens" ? <span className="activity-kind-icon activity-kind-icon--tokens activity-kind-icon--small" aria-hidden="true"><ArrowDownToLine size={12} /></span> : <span className="activity-dot" aria-hidden="true" />}
        <div><strong>{item.title}</strong><p>{item.detail}</p><time dateTime={new Date(item.timestamp).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(item.timestamp)}</time></div>
        <ArrowRight size={13} aria-hidden="true" />
      </Link>
    </li>)}</ol> : <p className="activity-empty">{t("activity.empty")}</p>}
  </section>;
}

export { EXPLORER };
