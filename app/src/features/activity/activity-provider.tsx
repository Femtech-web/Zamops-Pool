"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { useAccount } from "wagmi";

import { knownToken } from "@/features/pool/token-metadata";
import { useI18n } from "@/i18n/i18n-provider";

export type ActivityKind = "tokens" | "wrap" | "unwrap" | "deposit" | "claim" | "withdraw" | "draw";
export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  timestamp: number;
  txHash?: Hex;
  walletAddress?: `0x${string}`;
  contractAddress?: `0x${string}`;
  assetSymbol?: string;
  assetIcon?: string;
  encryptedAmountHandle?: Hex;
};
type PendingOperation = { title: string; detail: string; step: number; totalSteps: number };
type ErrorToast = { id: string; message: string };
type SuccessToast = { id: string; title: string; message: string };
type InfoToast = { id: string; title: string; message: string };
type ActivityContextValue = {
  activities: ActivityItem[];
  pending: PendingOperation | null;
  success: ActivityItem | null;
  successToast: SuccessToast | null;
  infoToast: InfoToast | null;
  errorToast: ErrorToast | null;
  begin: (operation: PendingOperation) => void;
  progress: (detail: string, step?: number) => void;
  complete: (activity: Omit<ActivityItem, "id" | "timestamp">) => void;
  fail: () => void;
  notifyError: (message: string) => void;
  notifySuccess: (title: string, message: string) => void;
  notifyInfo: (title: string, message: string) => void;
  dismissError: () => void;
  dismissSuccessToast: () => void;
  dismissInfoToast: () => void;
  dismissSuccess: () => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);
const STORAGE_PREFIX = "zamops-pool-activity-v1";

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  return <AccountActivityProvider key={address?.toLowerCase() ?? "disconnected"} address={address}>{children}</AccountActivityProvider>;
}

function AccountActivityProvider({ children, address }: { children: ReactNode; address: Hex | undefined }) {
  const { t } = useI18n();
  const [localActivities, setLocalActivities] = useState<ActivityItem[]>([]);
  const [indexedActivities, setIndexedActivities] = useState<ActivityItem[]>([]);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [success, setSuccess] = useState<ActivityItem | null>(null);
  const [errorToast, setErrorToast] = useState<ErrorToast | null>(null);
  const [successToast, setSuccessToast] = useState<SuccessToast | null>(null);
  const [infoToast, setInfoToast] = useState<InfoToast | null>(null);

  useEffect(() => {
    if (!errorToast) return;
    const timer = window.setTimeout(() => setErrorToast(null), 5_500);
    return () => window.clearTimeout(timer);
  }, [errorToast]);

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => setSuccessToast(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  useEffect(() => {
    if (!infoToast) return;
    const timer = window.setTimeout(() => setInfoToast(null), 5_500);
    return () => window.clearTimeout(timer);
  }, [infoToast]);

  useEffect(() => {
    try {
      const key = storageKey(address);
      const saved = JSON.parse(window.localStorage.getItem(key) ?? "[]") as ActivityItem[];
      const cleaned = saved.filter((item) => item.kind !== ("reveal" as ActivityKind) && item.kind !== "draw").slice(0, 100);
      window.localStorage.setItem(key, JSON.stringify(cleaned));
      const restore = window.setTimeout(() => setLocalActivities(cleaned), 0);
      return () => window.clearTimeout(restore);
    } catch { return; }
  }, [address]);

  useEffect(() => {
    const endpoint = process.env.NEXT_PUBLIC_ZAMOPS_POOL_SUBGRAPH_URL;
    if (!endpoint || !address) {
      const reset = window.setTimeout(() => setIndexedActivities([]), 0);
      return () => window.clearTimeout(reset);
    }
    const controller = new AbortController();
    void fetchIndexedActivities(endpoint, address, controller.signal, t)
      .then(setIndexedActivities)
      .catch(() => { if (!controller.signal.aborted) setIndexedActivities([]); });
    return () => controller.abort();
  }, [address, t]);

  const persist = useCallback((items: ActivityItem[]) => {
    setLocalActivities(items);
    window.localStorage.setItem(storageKey(address), JSON.stringify(items));
  }, [address]);

  const activities = useMemo(() => mergeActivities(indexedActivities, localActivities), [indexedActivities, localActivities]);

  const value = useMemo<ActivityContextValue>(() => ({
    activities,
    pending,
    success,
    successToast,
    infoToast,
    errorToast,
    begin: setPending,
    progress: (detail, step) => setPending((current) => current ? { ...current, detail, step: step ?? current.step } : current),
    complete: (activity) => {
      const item = { ...activity, walletAddress: address, id: crypto.randomUUID(), timestamp: Date.now() };
      const next = [item, ...localActivities].slice(0, 100);
      persist(next);
      setPending(null);
      setSuccess(item);
    },
    fail: () => setPending(null),
    notifyError: (message) => setErrorToast({ id: crypto.randomUUID(), message }),
    notifySuccess: (title, message) => setSuccessToast({ id: crypto.randomUUID(), title, message }),
    notifyInfo: (title, message) => setInfoToast({ id: crypto.randomUUID(), title, message }),
    dismissError: () => setErrorToast(null),
    dismissSuccessToast: () => setSuccessToast(null),
    dismissInfoToast: () => setInfoToast(null),
    dismissSuccess: () => setSuccess(null),
  }), [activities, address, errorToast, infoToast, localActivities, pending, persist, success, successToast]);

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

type IndexedRow = {
  id: string;
  type: "DEPOSIT" | "WITHDRAWAL" | "PRIZE_CLAIMED";
  pool: Hex;
  asset: Hex;
  encryptedAmount?: Hex;
  transactionHash: Hex;
  timestamp: string;
};

async function fetchIndexedActivities(endpoint: string, address: Hex, signal: AbortSignal, t: ReturnType<typeof useI18n>["t"]): Promise<ActivityItem[]> {
  const query = `query WalletActivity($account: Bytes!) { poolActivities(first: 100, orderBy: timestamp, orderDirection: desc, where: { account: $account, type_in: [DEPOSIT, WITHDRAWAL, PRIZE_CLAIMED] }) { id type pool asset encryptedAmount transactionHash timestamp } }`;
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { account: address.toLowerCase() } }), signal });
  if (!response.ok) throw new Error("Activity index unavailable");
  const payload = await response.json() as { data?: { poolActivities?: IndexedRow[] }; errors?: unknown[] };
  if (payload.errors || !payload.data?.poolActivities) throw new Error("Activity index unavailable");
  return payload.data.poolActivities.map((row) => indexedRowToActivity(row, address, t));
}

function indexedRowToActivity(row: IndexedRow, walletAddress: Hex, t: ReturnType<typeof useI18n>["t"]): ActivityItem {
  const token = knownToken(row.asset);
  const definition = indexedActivityDefinition(row.type, t);
  return { id: `indexed:${row.id}`, ...definition, timestamp: Number(row.timestamp) * 1_000, txHash: row.transactionHash, walletAddress, contractAddress: row.pool, assetSymbol: token.symbol, assetIcon: token.icon, encryptedAmountHandle: row.encryptedAmount };
}

function indexedActivityDefinition(type: IndexedRow["type"], t: ReturnType<typeof useI18n>["t"]): Pick<ActivityItem, "kind" | "title" | "detail"> {
  if (type === "DEPOSIT") return { kind: "deposit", title: t("success.depositTitle"), detail: t("success.depositDetail") };
  if (type === "WITHDRAWAL") return { kind: "withdraw", title: t("success.withdrawTitle"), detail: t("success.withdrawDetail") };
  return { kind: "claim", title: t("success.claimTitle"), detail: t("success.claimDetail") };
}

function mergeActivities(indexed: ActivityItem[], local: ActivityItem[]): ActivityItem[] {
  const moneyIndexed = indexed.filter((item) => item.kind !== "draw");
  const indexedKeys = new Set(moneyIndexed.map(activityKey));
  return [...moneyIndexed, ...local.filter((item) => item.kind !== "draw" && !indexedKeys.has(activityKey(item)))].sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
}

function activityKey(item: ActivityItem) { return item.txHash ? `${item.txHash}:${item.kind}` : item.id; }

function storageKey(address: string | undefined) {
  return `${STORAGE_PREFIX}:${address?.toLowerCase() ?? "disconnected"}`;
}

export function useActivity() {
  const context = useContext(ActivityContext);
  if (!context) throw new Error("useActivity must be used within ActivityProvider");
  return context;
}
