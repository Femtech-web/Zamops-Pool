import type { MessageKey } from "@/i18n/catalog";
import type { LocaleCode } from "@/i18n/locales";

type Translate = (key: MessageKey) => string;

type FaucetCooldown = {
  amount: string;
  locale: LocaleCode;
  nextClaimAt: string;
  symbol: string;
  t: Translate;
};

export function formatFaucetCooldown({ amount, locale, nextClaimAt, symbol, t }: FaucetCooldown) {
  const remainingSeconds = Math.max(0, Number(nextClaimAt) - Math.floor(Date.now() / 1_000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "long" });
  const retryTime = remainingSeconds >= 3_600
    ? formatter.format(Math.ceil(remainingSeconds / 3_600), "hour")
    : formatter.format(Math.max(1, Math.ceil(remainingSeconds / 60)), "minute");

  return t("faucet.cooldownDetail")
    .replace("{amount}", amount)
    .replace("{symbol}", symbol)
    .replace("{time}", retryTime);
}
