"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { catalogs, type MessageKey } from "./catalog";
import { defaultLocale, localeDefinitions, type LocaleCode } from "./locales";

type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = "zamops-pool-locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<LocaleCode>(defaultLocale);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!localeDefinitions.some((definition) => definition.code === saved)) return;
    const restoreLocale = window.setTimeout(() => setLocale(saved as LocaleCode), 0);
    return () => window.clearTimeout(restoreLocale);
  }, []);

  useEffect(() => {
    const definition = localeDefinitions.find((item) => item.code === locale);
    document.documentElement.lang = definition?.htmlLang ?? "en";
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => catalogs[locale][key] ?? catalogs.en[key] ?? key,
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
