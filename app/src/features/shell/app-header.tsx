"use client";

import Image from "next/image";
import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";

import { useI18n } from "@/i18n/i18n-provider";
import { useTheme } from "@/theme/theme-provider";
import { WalletButton } from "@/features/wallet/wallet-button";
import { LanguagePicker } from "./language-picker";

export function AppHeader() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <Link className="app-brand" href="/" aria-label="ZamOps Pool homepage">
          <span className="brand-logo-pair" aria-hidden="true">
            <Image className="brand-logo-light" src="/brand/zamops-icon.svg" alt="" width={29} height={29} priority />
            <Image className="brand-logo-dark" src="/brand/zamops-icon-invert.svg" alt="" width={29} height={29} priority />
          </span>
          <strong>ZamOps <span>/ {t("brand.product")}</span></strong>
        </Link>
        <nav className="app-nav" aria-label="Primary">
          <Link href="/app" aria-current={pathname === "/app" ? "page" : undefined}>{t("nav.pool")}</Link>
          <Link href="/app/tokens" aria-current={pathname === "/app/tokens" ? "page" : undefined}>{t("nav.tokens")}</Link>
          <Link href="/app/activity" aria-current={pathname === "/app/activity" ? "page" : undefined}>{t("nav.activity")}</Link>
        </nav>
      </div>

      <div className="app-actions">
        <LanguagePicker />
        <button
          className="icon-control theme-control"
          type="button"
          aria-label={theme === "light" ? t("theme.dark") : t("theme.light")}
          onClick={toggleTheme}
        >
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <WalletButton />
      </div>
    </header>
  );
}
