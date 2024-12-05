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
  sourcify: {
    enabled: false,
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
  etherscan: {
    apiKey: {
      morph: 'no-api-key-required',
      morphHolesky: 'no-api-key-required',
    },
    customChains: [
      {
        network: 'morph',
        chainId: 2818,
        urls: {
          apiURL: 'https://explorer-api.morphl2.io/api',
          browserURL: 'https://explorer.morphl2.io',
        },
      },
      {
        network: 'morphHolesky',
        chainId: 2810,
        urls: {
          apiURL: 'https://explorer-api-holesky.morphl2.io/api',
          browserURL: 'https://explorer-holesky.morphl2.io',
        },
      },
    ],
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
};

export default config;
