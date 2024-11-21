import { ethers, upgrades } from 'hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying contracts with the account:', deployer.address);

  const PointsRedemption = await ethers.getContractFactory('PointsRedemption');

  // Use the environment variable
  const GLOBAL_SIGNER = process.env.GLOBAL_SIGNER;

  const pointsRedemption = await upgrades.deployProxy(PointsRedemption, [GLOBAL_SIGNER]);
  await pointsRedemption.waitForDeployment();

  console.log('PointsRedemption deployed to:', await pointsRedemption.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
