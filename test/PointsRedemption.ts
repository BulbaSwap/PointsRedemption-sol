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
    const amount = ethers.parseEther('1000');

    it('Should allow owner to create redemption event', async function () {
      await expect(pointsRedemption.connect(owner).createRedemptionEvent(eventId))
        .to.emit(pointsRedemption, 'RedemptionEventCreated')
        .withArgs(eventId);

      const [tokenAddress] = await pointsRedemption.getTokenInfo(
        eventId,
        await mockToken.getAddress(),
      );
      expect(tokenAddress).to.equal(ethers.ZeroAddress);
    });

    it('Should not allow creating duplicate event', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption.connect(owner).addToken(eventId, await mockToken.getAddress(), amount);

      await expect(
        pointsRedemption.connect(owner).createRedemptionEvent(eventId),
      ).to.be.revertedWith('Event already exists');
    });

    it('Should allow adding ERC20 token to event', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);

      await expect(
        pointsRedemption.connect(owner).addToken(eventId, await mockToken.getAddress(), amount),
      )
        .to.emit(pointsRedemption, 'TokenAdded')
        .withArgs(eventId, await mockToken.getAddress(), amount);

      const [tokenAddress, totalAmount, remainingAmount] = await pointsRedemption.getTokenInfo(
        eventId,
        await mockToken.getAddress(),
      );
      expect(tokenAddress).to.equal(await mockToken.getAddress());
      expect(totalAmount).to.equal(amount);
      expect(remainingAmount).to.equal(amount);
    });

    it('Should allow adding ETH token to event', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);

      await expect(
        pointsRedemption
          .connect(owner)
          .addToken(eventId, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', amount, {
            value: amount,
          }),
      )
        .to.emit(pointsRedemption, 'TokenAdded')
        .withArgs(eventId, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', amount);
    });

    it('Should not allow adding token to inactive event', async function () {
      await expect(
        pointsRedemption.connect(owner).addToken(eventId, await mockToken.getAddress(), amount),
      ).to.be.revertedWith('Event not active');
    });

    it('Should not allow adding duplicate token', async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await mockToken.mint(owner.address, amount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), amount);

      await pointsRedemption.connect(owner).addToken(eventId, await mockToken.getAddress(), amount);

      await expect(
        pointsRedemption.connect(owner).addToken(eventId, await mockToken.getAddress(), amount),
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
    const amount = ethers.parseEther('1000');
    let token1: MockERC20;
    let token2: MockERC20;

    beforeEach(async function () {
      // Deploy two different mock tokens
      const MockERC20Factory = (await ethers.getContractFactory('MockERC20')) as MockERC20__factory;
      token1 = (await MockERC20Factory.deploy()) as MockERC20;
      token2 = (await MockERC20Factory.deploy()) as MockERC20;

      // Create event
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);

      // Add first token
      await token1.mint(owner.address, amount);
      await token1.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption.connect(owner).addToken(eventId, await token1.getAddress(), amount);

      // Add second token
      await token2.mint(owner.address, amount);
      await token2.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption.connect(owner).addToken(eventId, await token2.getAddress(), amount);

      // Deactivate event for withdrawal
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId + 1);
    });

    it('Should allow withdrawing remaining token amount', async function () {
      const ownerBalanceBefore = await token1.balanceOf(owner.address);

      await pointsRedemption
        .connect(owner)
        .withdrawRemainingToken(eventId, await token1.getAddress());

      const ownerBalanceAfter = await token1.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);

      const [, , remainingAmount] = await pointsRedemption.getTokenInfo(
        eventId,
        await token1.getAddress(),
      );
      expect(remainingAmount).to.equal(0);
    });

    it('Should allow withdrawing all tokens from an event', async function () {
      const ownerBalanceBefore1 = await token1.balanceOf(owner.address);
      const ownerBalanceBefore2 = await token2.balanceOf(owner.address);

      await pointsRedemption.connect(owner).withdrawEventTokens(eventId);

      const ownerBalanceAfter1 = await token1.balanceOf(owner.address);
      const ownerBalanceAfter2 = await token2.balanceOf(owner.address);

      expect(ownerBalanceAfter1 - ownerBalanceBefore1).to.equal(amount);
      expect(ownerBalanceAfter2 - ownerBalanceBefore2).to.equal(amount);

      const [, , remainingAmount1] = await pointsRedemption.getTokenInfo(
        eventId,
        await token1.getAddress(),
      );
      const [, , remainingAmount2] = await pointsRedemption.getTokenInfo(
        eventId,
        await token2.getAddress(),
      );
      expect(remainingAmount1).to.equal(0);
      expect(remainingAmount2).to.equal(0);
    });

    it('Should allow withdrawing tokens from a range of events', async function () {
      const eventId2 = 2;
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId2);
      await token1.mint(owner.address, amount);
      await token1.connect(owner).approve(pointsRedemption.getAddress(), amount);
      await pointsRedemption.connect(owner).addToken(eventId2, await token1.getAddress(), amount);

      // Deactivate event 2
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId2 + 1);

      const ownerBalanceBefore1 = await token1.balanceOf(owner.address);
      const ownerBalanceBefore2 = await token2.balanceOf(owner.address);

      await pointsRedemption.connect(owner).withdrawAllTokensInRange(eventId, eventId2);

      const ownerBalanceAfter1 = await token1.balanceOf(owner.address);
      const ownerBalanceAfter2 = await token2.balanceOf(owner.address);

      expect(ownerBalanceAfter1 - ownerBalanceBefore1).to.equal(amount * 2n); // From both events
      expect(ownerBalanceAfter2 - ownerBalanceBefore2).to.equal(amount); // Only from first event

      const [, , remainingAmount1] = await pointsRedemption.getTokenInfo(
        eventId,
        await token1.getAddress(),
      );
      const [, , remainingAmount2] = await pointsRedemption.getTokenInfo(
        eventId,
        await token2.getAddress(),
      );
      const [, , remainingAmount3] = await pointsRedemption.getTokenInfo(
        eventId2,
        await token1.getAddress(),
      );
      expect(remainingAmount1).to.equal(0);
      expect(remainingAmount2).to.equal(0);
      expect(remainingAmount3).to.equal(0);
    });

    it('Should skip non-existent events in range withdrawal', async function () {
      const ownerBalanceBefore1 = await token1.balanceOf(owner.address);
      const ownerBalanceBefore2 = await token2.balanceOf(owner.address);

      // Try to withdraw from a range including non-existent event
      await pointsRedemption.connect(owner).withdrawAllTokensInRange(eventId, eventId + 2);

      const ownerBalanceAfter1 = await token1.balanceOf(owner.address);
      const ownerBalanceAfter2 = await token2.balanceOf(owner.address);

      expect(ownerBalanceAfter1 - ownerBalanceBefore1).to.equal(amount); // Only from event1
      expect(ownerBalanceAfter2 - ownerBalanceBefore2).to.equal(amount); // Only from event1

      const [, , remainingAmount1] = await pointsRedemption.getTokenInfo(
        eventId,
        await token1.getAddress(),
      );
      const [, , remainingAmount2] = await pointsRedemption.getTokenInfo(
        eventId,
        await token2.getAddress(),
      );
      expect(remainingAmount1).to.equal(0);
      expect(remainingAmount2).to.equal(0);
    });
  });
});
