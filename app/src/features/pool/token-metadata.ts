import type { Address } from "viem";

export type FaucetCapability = "public" | "inventory";
export type KnownToken = { symbol: string; publicSymbol: string; name: string; faucet: FaucetCapability; icon: string };

const metadata: Record<string, KnownToken> = {
  "0x7c5bf43b851c1dff1a4fee8db225b87f2c223639": { symbol: "cUSDC", publicSymbol: "USDC", name: "Confidential USDC", faucet: "public", icon: "/token-icons/usdc.svg" },
  "0x4e7b06d78965594eb5ef5414c357ca21e1554491": { symbol: "cUSDT", publicSymbol: "USDT", name: "Confidential USDT", faucet: "public", icon: "/token-icons/usdt.svg" },
  "0x46208622da27d91db4f0393733c8ba082ed83158": { symbol: "cWETH", publicSymbol: "WETH", name: "Confidential Ether", faucet: "public", icon: "/token-icons/weth.svg" },
  "0xaa5612fa27c927a0c7961f5aefee5ba3a0f9c891": { symbol: "cBRON", publicSymbol: "BRON", name: "Confidential BRON", faucet: "public", icon: "/token-icons/bron.svg" },
  "0xf2d628d2598af4eaf94cb76a437ff86ca78ffbfb": { symbol: "cZAMA", publicSymbol: "ZAMA", name: "Confidential ZAMA", faucet: "public", icon: "/token-icons/zama.svg" },
  "0xfce5c7069c5525ef6c8c2b2e35a745ba20a2f7cc": { symbol: "ctGBP", publicSymbol: "tGBP", name: "Confidential test GBP", faucet: "public", icon: "/token-icons/tgbp.svg" },
  "0xe4fcf848739845bc81dee1d5352cf3844f0a60c7": { symbol: "cXAUt", publicSymbol: "XAUt", name: "Confidential Gold", faucet: "public", icon: "/token-icons/xaut.svg" },
  "0x167dc962808b32cfffc7e14b5018c0be06a3a208": { symbol: "ctGBP", publicSymbol: "tGBP", name: "Confidential GBP", faucet: "inventory", icon: "/token-icons/tgbp.svg" },
  "0x13f7d34a4f0102734f19e3ff16e068fe194b28c4": { symbol: "csteakcUSDC", publicSymbol: "steakcUSDC", name: "Confidential Steak USDC", faucet: "inventory", icon: "/token-icons/steakcusdc.avif" },
};

export function knownToken(address: Address): KnownToken {
  return metadata[address.toLowerCase()] ?? { symbol: "cToken", publicSymbol: "Token", name: "Confidential token", faucet: "inventory", icon: "/token-icons/confidential.svg" };
}
