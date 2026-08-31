"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { LanguagePicker } from "@/features/shell/language-picker";
import { useI18n } from "@/i18n/i18n-provider";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}<ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
    </a>
  );
}

export function DocsPage() {
  const { t } = useI18n();
  const sections = [
    ["start", t("docs.startHere")],
    ["journey", t("docs.usingPool")],
    ["draw", t("docs.draw")],
    ["privacy", t("docs.privacy")],
    ["funding", t("docs.noLoss")],
    ["automation", t("docs.automation")],
    ["proof", t("docs.contractsProof")],
  ] as const;

  return (
    <main className="docs-shell" id="main-content" tabIndex={-1}>
      <header className="docs-header">
        <Link className="docs-brand" href="/" aria-label={t("docs.homeLabel")}>
          <Image src="/brand/zamops-icon-invert.svg" alt="" width={29} height={29} priority />
          <strong>ZamOps <span>/ {t("brand.product")}</span></strong>
        </Link>
        <div className="docs-header-actions">
          <nav aria-label={t("docs.navigationLabel")}>
            <Link href="/">{t("nav.home")}</Link>
            <Link className="docs-open-app" href="/app">{t("landing.launch")}</Link>
          </nav>
          <LanguagePicker />
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-index" aria-label={t("docs.onThisPage")}>
          <p>{t("docs.onThisPage")}</p>
          <ol>
            {sections.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}
          </ol>
        </aside>

        <article className="docs-content">
          <section className="docs-intro" id="start">
            <p className="docs-kicker">{t("docs.kicker")}</p>
            <h1>{t("docs.title")}</h1>
            <p className="docs-lede">
              {t("docs.lede")}
            </p>
            <div className="docs-note">
              <span>{t("docs.testnet")}</span>
              <p>{t("docs.testnetBody")}</p>
            </div>
          </section>

          <section className="docs-section" id="journey">
            <p className="docs-section-number">01</p>
            <div>
              <h2>{t("docs.usingTitle")}</h2>
              <p>{t("docs.usingIntro")}</p>
              <ol className="docs-steps">
                <li><span>{t("docs.stepGet")}</span><p>{t("docs.stepGetBody")}</p></li>
                <li><span>{t("docs.stepShield")}</span><p>{t("docs.stepShieldBody")}</p></li>
                <li><span>{t("docs.stepDeposit")}</span><p>{t("docs.stepDepositBody")}</p></li>
                <li><span>{t("docs.stepReveal")}</span><p>{t("docs.stepRevealBody")}</p></li>
                <li><span>{t("docs.stepWin")}</span><p>{t("docs.stepWinBody")}</p></li>
                <li><span>{t("docs.stepLeave")}</span><p>{t("docs.stepLeaveBody")}</p></li>
              </ol>
            </div>
          </section>

          <section className="docs-section" id="draw">
            <p className="docs-section-number">02</p>
            <div>
              <h2>{t("docs.drawTitle")}</h2>
              <p>{t("docs.drawIntro")}</p>
              <div className="docs-range" aria-label={t("docs.rangeAria")}>
                <span style={{ "--range": 1 } as React.CSSProperties}>10</span>
                <span style={{ "--range": 3 } as React.CSSProperties}>30</span>
                <span style={{ "--range": 6 } as React.CSSProperties}>60</span>
              </div>
              <p>{t("docs.drawBody")}</p>
              <p className="docs-fine-print">{t("docs.drawNote")}</p>
            </div>
          </section>

          <section className="docs-section" id="privacy">
            <p className="docs-section-number">03</p>
            <div>
              <h2>{t("docs.privacyTitle")}</h2>
              <p>{t("docs.privacyIntro")}</p>
              <dl className="docs-privacy-grid">
                <div>
                  <dt>{t("docs.encrypted")}</dt>
                  <dd>{t("docs.encryptedAmounts")}</dd>
                  <dd>{t("docs.encryptedBalances")}</dd>
                  <dd>{t("docs.encryptedOdds")}</dd>
                  <dd>{t("docs.encryptedRandomness")}</dd>
                  <dd>{t("docs.encryptedWinner")}</dd>
                </div>
                <div>
                  <dt>{t("docs.public")}</dt>
                  <dd>{t("docs.publicWallets")}</dd>
                  <dd>{t("docs.publicTiming")}</dd>
                  <dd>{t("docs.publicDraw")}</dd>
                  <dd>{t("docs.publicCount")}</dd>
                  <dd>{t("docs.publicWeight")}</dd>
                </div>
              </dl>
              <p className="docs-fine-print">{t("docs.revealNote")}</p>
            </div>
          </section>

          <section className="docs-section" id="funding">
            <p className="docs-section-number">04</p>
            <div>
              <h2>{t("docs.fundingTitle")}</h2>
              <p>{t("docs.fundingBody")}</p>
              <p className="docs-fine-print">{t("docs.fundingNote")}</p>
            </div>
          </section>

          <section className="docs-section" id="automation">
            <p className="docs-section-number">05</p>
            <div>
              <h2>{t("docs.automationTitle")}</h2>
              <p>{t("docs.automationBody")}</p>
              <p>{t("docs.automationFallback")}</p>
            </div>
          </section>

          <section className="docs-section docs-proof" id="proof">
            <p className="docs-section-number">06</p>
            <div>
              <h2>{t("docs.proofTitle")}</h2>
              <p>{t("docs.proofIntro")}</p>
              <div className="docs-links">
                <ExternalLink href="https://github.com/Femtech-web/Zamops-Pool">{t("docs.sourceLink")}</ExternalLink>
                <ExternalLink href="https://sepolia.etherscan.io/address/0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2">{t("docs.factoryLink")}</ExternalLink>
                <ExternalLink href="https://eth-sepolia.blockscout.com/tx/0x043053976a6029c381ccabc349ca3b64456d3cd7619707b16872d520b493c718?tab=fhe_operations">{t("docs.blockscoutLink")}</ExternalLink>
              </div>
              <p className="docs-proof-stat">{t("docs.proofStats")}</p>
            </div>
          </section>

          <footer className="docs-footer">
            <p>{t("docs.ready")}</p>
            <Link href="/app">{t("docs.openPool")} <ArrowUpRight aria-hidden="true" size={16} /></Link>
          </footer>
        </article>
      </div>
    </main>
  );
}
