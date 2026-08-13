import type { DeployFunction } from "hardhat-deploy/types";

const SEPOLIA_REGISTRY = "0x2f0750Bbb0A246059d80e94c454586a7F27a128e";
const DEFAULT_DRAW_INTERVAL = 60 * 60;

const registryAbi = [
  "function getTokenConfidentialTokenPairs() view returns (tuple(address tokenAddress,address confidentialTokenAddress,bool isValid)[])",
];

const deployActivityV2: DeployFunction = async (hre) => {
  const { deployments, ethers, getNamedAccounts, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  if (network.name !== "sepolia") {
    log("Skipping ActivityV2 infrastructure outside Sepolia.");
    return;
  }

  const registryAddress = process.env.ZAMA_WRAPPERS_REGISTRY_ADDRESS ?? SEPOLIA_REGISTRY;
  const drawInterval = Number(process.env.POOL_DRAW_INTERVAL_SECONDS ?? DEFAULT_DRAW_INTERVAL);
  if (!Number.isSafeInteger(drawInterval) || drawInterval < 0 || drawInterval > 281_474_976_710_655) {
    throw new Error("POOL_DRAW_INTERVAL_SECONDS must fit uint48.");
  }

  const deployment = await deploy("ZamOpsPoolFactoryActivityV2", {
    contract: "ZamOpsPoolFactory",
    from: deployer,
    args: [registryAddress, drawInterval],
    log: true,
  });

  const signer = await ethers.getSigner(deployer);
  const registry = new ethers.Contract(registryAddress, registryAbi, signer);
  const factory = await ethers.getContractAt("ZamOpsPoolFactory", deployment.address, signer);
  const pairs = (await registry.getTokenConfidentialTokenPairs()) as Array<{
    tokenAddress: string;
    confidentialTokenAddress: string;
    isValid: boolean;
  }>;

  for (const pair of pairs) {
    if (!pair.isValid) continue;
    const existing = await factory.poolByAsset(pair.confidentialTokenAddress);
    if (existing !== ethers.ZeroAddress) continue;
    const receipt = await (await factory.createPool(pair.confidentialTokenAddress)).wait();
    log(`Created activity-v2 pool for ${pair.confidentialTokenAddress} (${receipt?.hash ?? "confirmed"}).`);
  }

  log(`Activity-v2 factory: ${deployment.address}`);
  log(`Activity-v2 start block: ${deployment.receipt?.blockNumber ?? "read deployment receipt"}`);
};

deployActivityV2.tags = ["PoolActivityV2"];

export default deployActivityV2;
