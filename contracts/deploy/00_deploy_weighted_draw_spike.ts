import type { DeployFunction } from "hardhat-deploy/types";

const deployWeightedDrawSpike: DeployFunction = async ({ deployments, getNamedAccounts }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy("EncryptedWeightedDrawSpike", {
    from: deployer,
    args: [],
    log: true,
  });
};

deployWeightedDrawSpike.tags = ["WeightedDrawSpike"];

export default deployWeightedDrawSpike;
