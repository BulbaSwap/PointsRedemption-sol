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
  let mockToken: MockERC20;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, signer, user] = signers;

    factory = await ethers.getContractFactory('PointsRedemption');
    globalSigner = signer.address;

    const contract = await upgrades.deployProxy(factory, [globalSigner], {
      initializer: 'initialize',
    });
    pointsRedemption = factory.attach(await contract.getAddress()) as PointsRedemption;

    const MockERC20Factory = (await ethers.getContractFactory('MockERC20')) as MockERC20__factory;
    mockToken = (await MockERC20Factory.deploy()) as MockERC20;
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

    it('Should allow owner to transfer ownership', async function () {
      await expect(pointsRedemption.connect(owner).transferOwnership(user.address))
        .to.emit(pointsRedemption, 'OwnershipTransferred')
        .withArgs(owner.address, user.address);

      expect(await pointsRedemption.owner()).to.equal(user.address);

      // Transfer back to original owner for other tests
      await pointsRedemption.connect(user).transferOwnership(owner.address);
    });

    it('Should not allow non-owner to transfer ownership', async function () {
      await expect(
        pointsRedemption.connect(user).transferOwnership(user.address),
      ).to.be.revertedWithCustomError(pointsRedemption, 'OwnableUnauthorizedAccount');
    });

    it('Should not allow transferring ownership to zero address', async function () {
      await expect(
        pointsRedemption.connect(owner).transferOwnership(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(pointsRedemption, 'OwnableInvalidOwner');
    });
  });

  describe('Event Management', function () {
    const eventId = 1;
    const tokenId = 0;
    const amount = ethers.parseEther('1000');
    const rate = ethers.parseEther('1'); // 1:1 rate

    it('Should allow owner to create redemption event', async function () {
      await expect(pointsRedemption.connect(owner).createRedemptionEvent(eventId))
        .to.emit(pointsRedemption, 'RedemptionEventCreated')
        .withArgs(eventId);

      const [tokenAddress] = await pointsRedemption.getTokenInfo(eventId, tokenId);
      expect(tokenAddress).to.equal(ethers.ZeroAddress);
    });

    it('Should not allow creating duplicate event', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption
        .connect(owner)
        .addToken(eventId, tokenId, await mockToken.getAddress(), amount, rate);

      await expect(
        pointsRedemption.connect(owner).createRedemptionEvent(eventId),
      ).to.be.revertedWith('Event already exists');
    });

    it('Should allow adding ERC20 token to event', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);

      await expect(
        pointsRedemption
          .connect(owner)
          .addToken(eventId, tokenId, await mockToken.getAddress(), amount, rate),
      )
        .to.emit(pointsRedemption, 'TokenAdded')
        .withArgs(eventId, tokenId, await mockToken.getAddress(), amount, rate);

      const [tokenAddress, totalAmount, remainingAmount, tokenRate] =
        await pointsRedemption.getTokenInfo(eventId, tokenId);
      expect(tokenAddress).to.equal(await mockToken.getAddress());
      expect(totalAmount).to.equal(amount);
      expect(remainingAmount).to.equal(amount);
      expect(tokenRate).to.equal(rate);
    });

    it('Should allow adding ETH token to event', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);

      await expect(
        pointsRedemption
          .connect(owner)
          .addToken(eventId, tokenId, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', amount, rate, {
            value: amount,
          }),
      )
        .to.emit(pointsRedemption, 'TokenAdded')
        .withArgs(eventId, tokenId, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', amount, rate);
    });

    it('Should not allow adding token to inactive event', async function () {
      await expect(
        pointsRedemption
          .connect(owner)
          .addToken(eventId, tokenId, await mockToken.getAddress(), amount, rate),
      ).to.be.revertedWith('Event not active');
    });

    it('Should not allow adding duplicate token ID', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);

      await pointsRedemption
        .connect(owner)
        .addToken(eventId, tokenId, await mockToken.getAddress(), amount, rate);

      await expect(
        pointsRedemption
          .connect(owner)
          .addToken(eventId, tokenId, await mockToken.getAddress(), amount, rate),
      ).to.be.revertedWith('Token already added');
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

  describe('Withdrawals', function () {
    const eventId = 1;
    const tokenId = 0;
    const amount = ethers.parseEther('1000');
    const rate = ethers.parseEther('1');

    beforeEach(async function () {
      // Create event
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);

      // Add first token
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption
        .connect(owner)
        .addToken(eventId, tokenId, await mockToken.getAddress(), amount, rate);

      // Add second token
      const tokenId2 = 1;
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption
        .connect(owner)
        .addToken(eventId, tokenId2, await mockToken.getAddress(), amount, rate);

      // Deactivate event for withdrawal
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId + 1);
    });

    it('Should allow withdrawing remaining token amount', async function () {
      const ownerBalanceBefore = await mockToken.balanceOf(owner.address);

      await pointsRedemption.connect(owner).withdrawRemainingToken(eventId, tokenId);

      const ownerBalanceAfter = await mockToken.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);

      const [, , remainingAmount] = await pointsRedemption.getTokenInfo(eventId, tokenId);
      expect(remainingAmount).to.equal(0);
    });

    it('Should allow withdrawing all tokens from an event', async function () {
      const ownerBalanceBefore = await mockToken.balanceOf(owner.address);

      await pointsRedemption.connect(owner).withdrawEventTokens(eventId);

      const ownerBalanceAfter = await mockToken.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount * 2n);

      const [, , remainingAmount1] = await pointsRedemption.getTokenInfo(eventId, tokenId);
      const [, , remainingAmount2] = await pointsRedemption.getTokenInfo(eventId, 1); // tokenId2
      expect(remainingAmount1).to.equal(0);
      expect(remainingAmount2).to.equal(0);
    });

    it('Should allow withdrawing tokens from a range of events', async function () {
      // Create and add token to event 2
      const eventId2 = 2;
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId2);
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption
        .connect(owner)
        .addToken(eventId2, tokenId, await mockToken.getAddress(), amount, rate);

      // Deactivate event 2
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId2 + 1);

      const ownerBalanceBefore = await mockToken.balanceOf(owner.address);

      await pointsRedemption.connect(owner).withdrawAllTokensInRange(eventId, eventId2);

      const ownerBalanceAfter = await mockToken.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount * 3n); // 2 tokens from event1 + 1 token from event2

      // Check all tokens have been withdrawn
      const [, , remainingAmount1] = await pointsRedemption.getTokenInfo(eventId, tokenId);
      const [, , remainingAmount2] = await pointsRedemption.getTokenInfo(eventId, 1);
      const [, , remainingAmount3] = await pointsRedemption.getTokenInfo(eventId2, tokenId);
      expect(remainingAmount1).to.equal(0);
      expect(remainingAmount2).to.equal(0);
      expect(remainingAmount3).to.equal(0);
    });

    it('Should skip non-existent events in range withdrawal', async function () {
      const ownerBalanceBefore = await mockToken.balanceOf(owner.address);

      // Try to withdraw from a range including non-existent event
      await pointsRedemption.connect(owner).withdrawAllTokensInRange(eventId, eventId + 2);

      const ownerBalanceAfter = await mockToken.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount * 2n); // Only tokens from event1

      const [, , remainingAmount1] = await pointsRedemption.getTokenInfo(eventId, tokenId);
      const [, , remainingAmount2] = await pointsRedemption.getTokenInfo(eventId, 1);
      expect(remainingAmount1).to.equal(0);
      expect(remainingAmount2).to.equal(0);
    });
  });
});
