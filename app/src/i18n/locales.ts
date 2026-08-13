export const localeCodes = ["en", "fr", "zh", "es", "ko", "vi"] as const;
export type LocaleCode = (typeof localeCodes)[number];

export type LocaleDefinition = {
  code: LocaleCode;
  label: string;
  nativeLabel: string;
  flag: string;
  htmlLang: string;
};

export const localeDefinitions: LocaleDefinition[] = [
  { code: "en", label: "English", nativeLabel: "English", flag: "gb", htmlLang: "en" },
  { code: "fr", label: "French", nativeLabel: "Français", flag: "fr", htmlLang: "fr" },
  { code: "zh", label: "Chinese", nativeLabel: "简体中文", flag: "cn", htmlLang: "zh-CN" },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "es", htmlLang: "es" },
  { code: "ko", label: "Korean", nativeLabel: "한국어", flag: "kr", htmlLang: "ko" },
  { code: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt", flag: "vn", htmlLang: "vi" },
];

export const defaultLocale: LocaleCode = "en";

