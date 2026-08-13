"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZamaProvider } from "@zama-fhe/react-sdk";
import { indexedDBStorage } from "@zama-fhe/sdk";
import { sepolia as zamaSepolia, type FheChain } from "@zama-fhe/sdk/chains";
import { createConfig as createZamaConfig } from "@zama-fhe/sdk/viem";
import { web } from "@zama-fhe/sdk/web";
import { useMemo, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount, usePublicClient, useWalletClient } from "wagmi";

import { SEPOLIA_RPC_URL } from "@/config/contracts";
import { walletConfig } from "@/config/wallet";
import { I18nProvider } from "@/i18n/i18n-provider";
import { ThemeProvider } from "@/theme/theme-provider";
import { ActivityProvider } from "@/features/activity/activity-provider";

const zamaChain = { ...zamaSepolia, network: SEPOLIA_RPC_URL } as const satisfies FheChain;
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            staleTime: 12_000,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={walletConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
            theme={darkTheme({
              accentColor: "#d9bc63",
              accentColorForeground: "#171815",
              borderRadius: "small",
              fontStack: "system",
              overlayBlur: "small",
            })}
          >
            <ThemeProvider>
              <I18nProvider><ActivityProvider><ZamaBridge>{children}</ZamaBridge></ActivityProvider></I18nProvider>
            </ThemeProvider>
          </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function ZamaBridge({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const wallet = useWalletClient();
  const config = useMemo(() => {
    if (!publicClient || !wallet.data) return null;
    return createZamaConfig({
      chains: [zamaChain],
      publicClient,
      walletClient: wallet.data,
      relayers: { [zamaChain.id]: web({ timeout: 5 * 60_000 }) },
      storage: indexedDBStorage,
      permitStorage: indexedDBStorage,
    });
  }, [publicClient, wallet.data]);

  if (!isConnected) return children;
  if (!config) return null;
  return <ZamaProvider config={config}>{children}</ZamaProvider>;
}
