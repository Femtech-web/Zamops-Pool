import {
  ChainMismatchError,
  DecryptionFailedError,
  EncryptionFailedError,
  InsufficientAllowanceError,
  InsufficientConfidentialBalanceError,
  InsufficientERC20BalanceError,
  RelayerRequestFailedError,
  RpcRateLimitError,
  SigningRejectedError,
  TransactionRevertedError,
  TransportKeyPairExpiredError,
  WalletNotConnectedError,
} from "@zama-fhe/sdk";

import type { MessageKey } from "@/i18n/catalog";

type Translate = (key: MessageKey) => string;

export function toUserFacingError(error: unknown, t: Translate): string {
  if (hasMessage(error, "invalid decimal") || hasMessage(error, "amount must") || hasMessage(error, "cannot convert")) {
    return t("error.amount");
  }
  if (hasMessage(error, "faucet cooldown")) return t("error.faucetCooldown");
  if (hasMessage(error, "faucet token unavailable")) return t("error.faucetToken");
  if (hasMessage(error, "faucet service unavailable")) return t("error.faucetService");
  if (error instanceof SigningRejectedError || hasMessage(error, "user rejected") || hasMessage(error, "user denied")) {
    return t("error.cancelled");
  }
  if (error instanceof WalletNotConnectedError) return t("error.connectWallet");
  if (error instanceof ChainMismatchError || hasMessage(error, "chain mismatch") || hasMessage(error, "wrong network")) {
    return t("error.network");
  }
  if (error instanceof InsufficientERC20BalanceError || hasMessage(error, "insufficient balance")) {
    return t("error.publicBalance");
  }
  if (error instanceof InsufficientConfidentialBalanceError) return t("error.privateBalance");
  if (error instanceof InsufficientAllowanceError) return t("error.approval");
  if (error instanceof EncryptionFailedError) return t("error.encryption");
  if (error instanceof DecryptionFailedError || error instanceof TransportKeyPairExpiredError) return t("error.reveal");
  if (error instanceof RpcRateLimitError || error instanceof RelayerRequestFailedError) return t("error.serviceBusy");
  if (error instanceof TransactionRevertedError || hasMessage(error, "reverted")) return t("error.reverted");
  return t("error.unknown");
}

function hasMessage(error: unknown, fragment: string) {
  return error instanceof Error && error.message.toLowerCase().includes(fragment);
}
