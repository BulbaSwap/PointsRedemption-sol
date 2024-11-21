import { HardhatUserConfig } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import '@typechain/hardhat';
import * as dotenv from 'dotenv';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.27',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    morph: {
      url: 'https://rpc.morphl2.io',
      accounts: [process.env.PRIVATE_KEY || '', process.env.GLOBAL_SIGNER_PRIVATE_KEY || ''].filter(
        (key) => key !== '',
      ),
      timeout: 60000,
      gasPrice: 'auto',
    },
    morphHolesky: {
      url: 'https://rpc-holesky.morphl2.io',
      accounts: [process.env.PRIVATE_KEY || '', process.env.GLOBAL_SIGNER_PRIVATE_KEY || ''].filter(
        (key) => key !== '',
      ),
      timeout: 60000,
      gasPrice: 'auto',
    },
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
};

export default config;
