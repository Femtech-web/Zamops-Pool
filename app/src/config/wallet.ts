"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  safeWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";

import { SEPOLIA_RPC_URL } from "@/config/contracts";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const hasWalletConnect = Boolean(
  projectId && !["PROJECT_ID", "YOUR_PROJECT_ID", "ZAMOPS_DEVELOPMENT_PROJECT_ID"].includes(projectId),
);
const transports = { [sepolia.id]: http(SEPOLIA_RPC_URL) };

export const walletConfig = hasWalletConnect
  ? getDefaultConfig({
      appName: "ZamOps Pool",
      projectId: projectId!,
      chains: [sepolia],
      transports,
      ssr: false,
    })
  : createConfig({
      chains: [sepolia],
      connectors: connectorsForWallets(
        [
          { groupName: "Recommended", wallets: [metaMaskWallet, coinbaseWallet, injectedWallet] },
          { groupName: "Installed wallets", wallets: [rabbyWallet, safeWallet] },
        ],
        { appName: "ZamOps Pool", projectId: "direct-wallets-only" },
      ),
      transports,
      ssr: false,
    });
