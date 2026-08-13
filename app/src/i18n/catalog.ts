import en from "./messages/en.json";
import es from "./messages/es.json";
import fr from "./messages/fr.json";
import ko from "./messages/ko.json";
import vi from "./messages/vi.json";
import zh from "./messages/zh.json";
import type { LocaleCode } from "./locales";

export type MessageKey = keyof typeof en;
export type MessageCatalog = Partial<Record<MessageKey, string>>;

export const catalogs: Record<LocaleCode, MessageCatalog> = { en, fr, zh, es, ko, vi };
