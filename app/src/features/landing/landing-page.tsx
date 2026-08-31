"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { LanguagePicker } from "@/features/shell/language-picker";
import { useI18n } from "@/i18n/i18n-provider";

function LaunchArrow() {
  return (
    <span className="landing-launch-arrow" aria-hidden="true">
      <span className="landing-launch-arrow-glyph">↗</span>
      <ArrowUpRight className="landing-launch-arrow-icon" size={15} strokeWidth={2} />
    </span>
  );
}

export function LandingPage() {
  const { t } = useI18n();

  return (
    <main className="landing-shell" id="main-content" tabIndex={-1}>
      <header className="landing-header">
        <Link className="landing-brand" href="/" aria-label="ZamOps Pool home">
          <Image src="/brand/zamops-icon-invert.svg" alt="" width={30} height={30} priority />
          <strong>ZamOps <span>/ Pool</span></strong>
        </Link>
        <nav aria-label="Homepage">
          <a href="#how">{t("landing.navHow")}</a>
          <a href="#privacy">{t("landing.navPrivacy")}</a>
          <Link href="/docs">{t("landing.navDocs")}</Link>
        </nav>
        <div className="landing-actions">
          <Link className="landing-docs-small" href="/docs">{t("landing.navDocs")}</Link>
          <LanguagePicker />
          <Link className="landing-launch-small" href="/app">{t("landing.launch")}</Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="ambient-field" aria-hidden="true">
          <i /><i /><i />
        </div>
        <div className="landing-hero-copy">
          <p className="landing-kicker">{t("landing.kicker")}</p>
          <h1>{t("landing.title")}</h1>
          <p>{t("landing.intro")}</p>
          <Link className="landing-launch" href="/app">{t("landing.launch")} <LaunchArrow /></Link>
        </div>
        <p className="landing-network"><i />{t("network.sepolia")}</p>
      </section>

      <section className="landing-principles" id="how">
        <header>
          <p>{t("landing.principlesKicker")}</p>
          <h2>{t("landing.principlesTitle")}</h2>
        </header>
        <div className="principle-list">
          <article><span>01</span><div><h3>{t("landing.privateTitle")}</h3><p>{t("landing.privateBody")}</p></div></article>
          <article><span>02</span><div><h3>{t("landing.fairTitle")}</h3><p>{t("landing.fairBody")}</p></div></article>
          <article><span>03</span><div><h3>{t("landing.protectedTitle")}</h3><p>{t("landing.protectedBody")}</p></div></article>
        </div>
      </section>

      <section className="landing-privacy" id="privacy">
        <div className="privacy-visual" aria-hidden="true"><span /><span /><span /></div>
        <div>
          <p className="landing-section-label">{t("landing.privacyKicker")}</p>
          <h2>{t("landing.privacyTitle")}</h2>
          <p>{t("landing.privacyBody")}</p>
          <dl>
            <div><dt>{t("landing.encrypted")}</dt><dd>{t("landing.encryptedItems")}</dd></div>
            <div><dt>{t("landing.public")}</dt><dd>{t("landing.publicItems")}</dd></div>
          </dl>
        </div>
      </section>

      <section className="landing-close">
        <p>{t("landing.closeKicker")}</p>
        <h2>{t("landing.closeTitle")}</h2>
        <Link href="/app">{t("landing.launch")} <LaunchArrow /></Link>
      </section>

      <footer className="landing-footer">
        <span>ZamOps Pool</span>
        <p>{t("landing.footer")}</p>
        <span>Ethereum Sepolia · Zama FHEVM</span>
      </footer>
    </main>
  );
}
