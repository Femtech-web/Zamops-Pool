import type { DeployFunction } from "hardhat-deploy/types";

const SEPOLIA_REGISTRY = "0x2f0750Bbb0A246059d80e94c454586a7F27a128e";
const DEFAULT_DRAW_INTERVAL = 60 * 60;

// Official Sepolia mock underlyings whose mint(address,uint256) is publicly callable.
const PUBLIC_MINT_UNDERLYINGS = new Set([
  "0x9b5cd13b8efbb58dc25a05cf411d8056058adfff", // USDCMock
  "0xa7da08fafdc9097cc0e7d4f113a61e31d7e8e9b0", // USDTMock
  "0xff54739b16576fa5402f211d0b938469ab9a5f3f", // WETHMock
  "0xff021fb13ca64e5354c62c954b949a88cfdeb25e", // BRONMock
  "0x75355a85c6fb9df5f0c80ff54e8747eee9a0bf57", // ZAMAMock
  "0x93c931278a2aad1916783f952f94276ea5111442", // tGBPMock
  "0x24377ae4aa0c45ecee71225007f17c5d423dd940", // XAUtMock
]);

const registryAbi = [
  "function getTokenConfidentialTokenPairs() view returns (tuple(address tokenAddress,address confidentialTokenAddress,bool isValid)[])",
];

const erc20MetadataAbi = ["function decimals() view returns (uint8)"];

const deployPoolInfrastructure: DeployFunction = async (hre) => {
  const { deployments, ethers, getNamedAccounts, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  const configuredRegistry = process.env.ZAMA_WRAPPERS_REGISTRY_ADDRESS;
  if (network.name !== "sepolia" && !configuredRegistry) {
    log("Skipping PoolInfrastructure: set ZAMA_WRAPPERS_REGISTRY_ADDRESS outside Sepolia.");
    return;
  }

  const registryAddress = configuredRegistry ?? SEPOLIA_REGISTRY;
  const drawInterval = Number(process.env.POOL_DRAW_INTERVAL_SECONDS ?? DEFAULT_DRAW_INTERVAL);
  if (!Number.isSafeInteger(drawInterval) || drawInterval < 0 || drawInterval > 281_474_976_710_655) {
    throw new Error("POOL_DRAW_INTERVAL_SECONDS must fit uint48.");
  }

  const factoryDeployment = await deploy("ZamOpsPoolFactory", {
    from: deployer,
    args: [registryAddress, drawInterval],
    log: true,
  });
  const faucetDeployment = await deploy("ZamOpsPoolFaucet", {
    from: deployer,
    args: [deployer],
    log: true,
  });

  const signer = await ethers.getSigner(deployer);
  const registry = new ethers.Contract(registryAddress, registryAbi, signer);
  const factory = await ethers.getContractAt("ZamOpsPoolFactory", factoryDeployment.address, signer);
  const faucet = await ethers.getContractAt("ZamOpsPoolFaucet", faucetDeployment.address, signer);
  const pairs = (await registry.getTokenConfidentialTokenPairs()) as Array<{
    tokenAddress: string;
    confidentialTokenAddress: string;
    isValid: boolean;
  }>;

  for (const pair of pairs) {
    if (!pair.isValid) continue;

    const existingPool = await factory.poolByAsset(pair.confidentialTokenAddress);
    if (existingPool === ethers.ZeroAddress) {
      const receipt = await (await factory.createPool(pair.confidentialTokenAddress)).wait();
      log(`Created ${pair.confidentialTokenAddress} pool (${receipt?.hash ?? "confirmed"}).`);
    }

    if (!PUBLIC_MINT_UNDERLYINGS.has(pair.tokenAddress.toLowerCase())) continue;
    const token = new ethers.Contract(pair.tokenAddress, erc20MetadataAbi, signer);
    const decimals = Number(await token.decimals());
    const claimAmount = ethers.parseUnits("1000", decimals);
    const config = await faucet.getFaucetToken(pair.tokenAddress);
    if (!config.enabled || config.claimAmount !== claimAmount) {
      await (await faucet.configureToken(pair.tokenAddress, claimAmount, true)).wait();
      log(`Enabled faucet for ${pair.tokenAddress}.`);
    }
  }

  const relayer = process.env.FAUCET_RELAYER_ADDRESS;
  if (relayer && !(await faucet.relayers(relayer))) {
    await (await faucet.configureRelayer(relayer, true)).wait();
    log(`Enabled faucet relayer ${relayer}.`);
  }
};

deployPoolInfrastructure.tags = ["PoolInfrastructure"];

export default deployPoolInfrastructure;
