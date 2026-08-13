"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

import { useI18n } from "@/i18n/i18n-provider";

export function WalletButton() {
  const { t } = useI18n();

  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const connected = mounted && account && chain;
        if (!mounted) return <span className="wallet-skeleton" aria-hidden="true" />;
        if (!connected) return <button className="connect-button" type="button" onClick={openConnectModal}>{t("wallet.connect")}</button>;
        if (chain.unsupported) return <button className="connect-button network-warning" type="button" onClick={openChainModal}>{t("wallet.switchNetwork")}</button>;

        return (
          <button className="connected-wallet" type="button" onClick={openAccountModal} aria-label={t("wallet.manage")}>
            <span aria-hidden="true" />
            <b>{account.displayName}</b>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
