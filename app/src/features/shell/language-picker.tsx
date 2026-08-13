"use client";

import Image from "next/image";
import { Check, ChevronDown, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/i18n/i18n-provider";
import { localeDefinitions } from "@/i18n/locales";

export function LanguagePicker() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = localeDefinitions.find((item) => item.code === locale) ?? localeDefinitions[0];

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div className="language-menu" ref={rootRef}>
      <button
        className="icon-control language-trigger"
        type="button"
        aria-label={t("language.change")}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <Languages size={15} aria-hidden="true" />
        <span>{active.code.toUpperCase()}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className="language-popover" role="menu" aria-label={t("language.change")}>
          {localeDefinitions.map((definition) => (
            <button
              key={definition.code}
              type="button"
              role="menuitemradio"
              aria-checked={locale === definition.code}
              onClick={() => {
                setLocale(definition.code);
                setOpen(false);
              }}
            >
              <Image
                src={`/flags/${definition.flag}.png`}
                alt=""
                width={20}
                height={14}
              />
              <span>
                <strong>{definition.nativeLabel}</strong>
                <small>{definition.label}</small>
              </span>
              {locale === definition.code ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

