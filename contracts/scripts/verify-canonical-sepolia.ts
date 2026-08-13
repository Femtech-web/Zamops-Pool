import hre from "hardhat";

const REGISTRY = "0x2f0750Bbb0A246059d80e94c454586a7F27a128e";
const DRAW_INTERVAL = 3_600;
const FACTORY = "0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2";
const FAUCET = "0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F";
const FAUCET_OWNER = "0xcc886a72f79BaEd0098432704a65373F52131c54";

const POOLS = [
  ["cUSDC", "0x7c5bf43b851c1dff1a4fee8db225b87f2c223639", "0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327"],
  ["cUSDT", "0x4e7b06d78965594eb5ef5414c357ca21e1554491", "0x2411d25929564Dc89502d02d502Be295703DdAf6"],
  ["cWETH", "0x46208622da27d91db4f0393733c8ba082ed83158", "0xd91358f869b26B9Ef61AA7A900111A98109CF41a"],
  ["cBRON", "0xaa5612fa27c927a0c7961f5aefee5ba3a0f9c891", "0x95cc93C58F5386f1420F67F2C8ceBd8C05450452"],
  ["cZAMA", "0xf2d628d2598af4eaf94cb76a437ff86ca78ffbfb", "0x9820488e1A5c7Dca5D57387c5f5D8ac35f140675"],
  ["ctGBP (mock)", "0xfce5c7069c5525ef6c8c2b2e35a745ba20a2f7cc", "0xbbcAc223967DCF3dBfD6fbeC3D47AB98cCDf6bE8"],
  ["cXAUt", "0xe4fcf848739845bc81dee1d5352cf3844f0a60c7", "0x1858B04892E3017F783dF51C21A191a88A452E05"],
  ["ctGBP (inventory)", "0x167dc962808b32cfffc7e14b5018c0be06a3a208", "0x88CDE42A020956167FA2c79Ffa26D7B5918Fb427"],
  ["csteakcUSDC", "0x13f7d34a4f0102734f19e3ff16e068fe194b28c4", "0x29c1b12004E649cF67E3a2A37Fc24A91Bd9bf9a1"],
] as const;

async function verify(label: string, address: string, constructorArguments: readonly unknown[], contract: string) {
  try {
    await hre.run("verify:verify", { address, constructorArguments: [...constructorArguments], contract });
    console.log(`Verified ${label}: ${address}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already verified/i.test(message)) {
      console.log(`Already verified ${label}: ${address}`);
      return;
    }
    throw new Error(`Could not verify ${label} (${address}): ${message}`);
  }
}

async function main() {
  if (!process.env.ETHERSCAN_API_KEY?.trim()) throw new Error("Set ETHERSCAN_API_KEY before running canonical verification.");

  await verify("factory", FACTORY, [REGISTRY, DRAW_INTERVAL], "contracts/ZamOpsPoolFactory.sol:ZamOpsPoolFactory");
  await verify("faucet", FAUCET, [FAUCET_OWNER], "contracts/ZamOpsPoolFaucet.sol:ZamOpsPoolFaucet");
  for (const [symbol, asset, pool] of POOLS) {
    await verify(`${symbol} pool`, pool, [REGISTRY, asset, DRAW_INTERVAL], "contracts/ConfidentialPrizePool.sol:ConfidentialPrizePool");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
