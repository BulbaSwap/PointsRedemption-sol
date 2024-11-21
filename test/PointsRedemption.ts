import { ethers, upgrades } from 'hardhat';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { PointsRedemption, PointsRedemption__factory } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { MockERC20, MockERC20__factory } from '../typechain-types';

describe('PointsRedemption', function () {
  let pointsRedemption: PointsRedemption;
  let owner: HardhatEthersSigner;
  let signer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let globalSigner: string;
  let factory: PointsRedemption__factory;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, signer, user] = signers;

    factory = await ethers.getContractFactory('PointsRedemption');
    globalSigner = signer.address;

    if (!process.env.NETWORK || process.env.NETWORK === 'hardhat') {
      const contract = await upgrades.deployProxy(factory, [globalSigner], {
        initializer: 'initialize',
      });
      pointsRedemption = factory.attach(await contract.getAddress()) as PointsRedemption;
    } else {
      const DEPLOYED_CONTRACT_ADDRESS = '0xbEfea4D934B35510FBe998CA25EA75619546c8be';
      pointsRedemption = factory.attach(DEPLOYED_CONTRACT_ADDRESS) as PointsRedemption;
    }
  });

  describe('Deployment', function () {
    it('Should set the right global signer', async function () {
      const currentSigner = await pointsRedemption.globalSigner();
      expect(currentSigner).to.equal(globalSigner);
    });

    it('Should set the right owner', async function () {
      const contractOwner = await pointsRedemption.owner();
      expect(contractOwner).to.equal(owner.address);
    });
  });

  describe('Permissions', function () {
    it('Should allow owner to set new global signer', async function () {
      await expect(pointsRedemption.connect(owner).setGlobalSigner(user.address))
        .to.emit(pointsRedemption, 'GlobalSignerUpdated')
        .withArgs(user.address);

      expect(await pointsRedemption.globalSigner()).to.equal(user.address);

      await pointsRedemption.connect(owner).setGlobalSigner(globalSigner);
    });

    it('Should not allow non-owner to set global signer', async function () {
      await expect(
        pointsRedemption.connect(user).setGlobalSigner(user.address),
      ).to.be.revertedWithCustomError(pointsRedemption, 'OwnableUnauthorizedAccount');
    });

    it('Should not allow setting zero address as global signer', async function () {
      await expect(
        pointsRedemption.connect(owner).setGlobalSigner(ethers.ZeroAddress),
      ).to.be.revertedWith('Invalid signer address');
    });

    it('Should allow owner to create redemption event with ERC20', async function () {
      const MockERC20Factory = (await ethers.getContractFactory('MockERC20')) as MockERC20__factory;
      const token = (await MockERC20Factory.deploy()) as MockERC20;
      const amount = ethers.parseEther('1000');

      // Approve tokens first
      await token.mint(owner.address, amount);
      await token.approve(pointsRedemption.getAddress(), amount);

      const eventId = 1;
      const startTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      await expect(
        pointsRedemption
          .connect(owner)
          .createRedemptionEvent(
            eventId,
            await token.getAddress(),
            amount,
            startTime,
            ethers.parseEther('10'),
            ethers.parseEther('100'),
          ),
      )
        .to.emit(pointsRedemption, 'RedemptionEventCreated')
        .withArgs(eventId, await token.getAddress(), amount, startTime);
    });

    it('Should allow owner to create redemption event with ETH', async function () {
      const eventId = 2;
      const amount = ethers.parseEther('10');
      const startTime = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        pointsRedemption
          .connect(owner)
          .createRedemptionEvent(
            eventId,
            ethers.ZeroAddress,
            amount,
            startTime,
            ethers.parseEther('0.1'),
            ethers.parseEther('1'),
            { value: amount },
          ),
      )
        .to.emit(pointsRedemption, 'RedemptionEventCreated')
        .withArgs(eventId, ethers.ZeroAddress, amount, startTime);
    });

    it('Should not allow non-owner to create redemption event', async function () {
      const eventId = 3;
      const amount = ethers.parseEther('10');
      const startTime = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        pointsRedemption
          .connect(user)
          .createRedemptionEvent(
            eventId,
            ethers.ZeroAddress,
            amount,
            startTime,
            ethers.parseEther('0.1'),
            ethers.parseEther('1'),
            { value: amount },
          ),
      ).to.be.revertedWithCustomError(pointsRedemption, 'OwnableUnauthorizedAccount');
    });

    it('Should not allow creating event with past start time', async function () {
      const eventId = 4;
      const amount = ethers.parseEther('10');
      const startTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      await expect(
        pointsRedemption
          .connect(owner)
          .createRedemptionEvent(
            eventId,
            ethers.ZeroAddress,
            amount,
            startTime,
            ethers.parseEther('0.1'),
            ethers.parseEther('1'),
            { value: amount },
          ),
      ).to.be.revertedWith('Start time must be in future');
    });

    it('Should not allow creating event with invalid limits', async function () {
      const eventId = 5;
      const amount = ethers.parseEther('10');
      const startTime = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        pointsRedemption.connect(owner).createRedemptionEvent(
          eventId,
          ethers.ZeroAddress,
          amount,
          startTime,
          ethers.parseEther('1'),
          ethers.parseEther('0.5'), // max < min
          { value: amount },
        ),
      ).to.be.revertedWith('Invalid limits');
    });
  });

  describe('Upgrades', function () {
    it('Should be upgradeable', async function () {
      const PointsRedemptionV2 = await ethers.getContractFactory('PointsRedemption');
      const upgraded = PointsRedemptionV2.attach(
        await (
          await upgrades.upgradeProxy(await pointsRedemption.getAddress(), PointsRedemptionV2)
        ).getAddress(),
      ) as PointsRedemption;

      expect(await upgraded.getAddress()).to.equal(await pointsRedemption.getAddress());
      expect(await upgraded.globalSigner()).to.equal(globalSigner);
      expect(await upgraded.owner()).to.equal(owner.address);
    });

    it('Should maintain state after upgrade', async function () {
      await pointsRedemption.connect(owner).setGlobalSigner(user.address);

      const PointsRedemptionV2 = await ethers.getContractFactory('PointsRedemption');
      const upgraded = PointsRedemptionV2.attach(
        await (
          await upgrades.upgradeProxy(await pointsRedemption.getAddress(), PointsRedemptionV2)
        ).getAddress(),
      ) as PointsRedemption;

      expect(await upgraded.globalSigner()).to.equal(user.address);
      await upgraded.connect(owner).setGlobalSigner(globalSigner);
    });
  });
});
