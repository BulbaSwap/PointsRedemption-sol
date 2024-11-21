import { ethers, upgrades } from 'hardhat';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { PointsRedemption, PointsRedemption__factory } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { MockERC20, MockERC20__factory } from '../typechain-types';

describe('Claiming', function () {
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
    globalSigner = signer.address;

    // Deploy PointsRedemption
    factory = await ethers.getContractFactory('PointsRedemption');
    const contract = await upgrades.deployProxy(factory, [globalSigner], {
      initializer: 'initialize',
    });
    pointsRedemption = factory.attach(await contract.getAddress()) as PointsRedemption;

    // Deploy MockERC20
    const MockERC20Factory = (await ethers.getContractFactory('MockERC20')) as MockERC20__factory;
    mockToken = (await MockERC20Factory.deploy()) as MockERC20;
  });

  describe('Claiming ETH', function () {
    const eventId = 1;
    const totalAmount = ethers.parseEther('10');
    const claimAmount = ethers.parseEther('1');
    const startTime = async () => {
      const currentBlock = await ethers.provider.getBlock('latest');
      return (currentBlock?.timestamp || Math.floor(Date.now() / 1000)) + 60; // Start 60 seconds in future
    };
    const minLimit = ethers.parseEther('0.1');
    const maxLimit = ethers.parseEther('2');

    beforeEach(async function () {
      // Create ETH redemption event
      await pointsRedemption
        .connect(owner)
        .createRedemptionEvent(
          eventId,
          ethers.ZeroAddress,
          totalAmount,
          await startTime(),
          minLimit,
          maxLimit,
          { value: totalAmount },
        );
    });

    it('Should successfully claim ETH with valid signature', async function () {
      // Fast forward time to after start time
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, claimAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      const initialBalance = await ethers.provider.getBalance(user.address);

      await expect(
        pointsRedemption.connect(user).claim(eventId, claimAmount, claimNonce, signature),
      )
        .to.emit(pointsRedemption, 'TokensClaimed')
        .withArgs(eventId, user.address, claimAmount, claimNonce);

      const finalBalance = await ethers.provider.getBalance(user.address);
      expect(finalBalance - initialBalance).to.be.closeTo(
        claimAmount,
        ethers.parseEther('0.01'), // Allow for gas costs
      );
    });

    it('Should not allow duplicate claims with same signature', async function () {
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, claimAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      // First claim should succeed
      await pointsRedemption.connect(user).claim(eventId, claimAmount, claimNonce, signature);

      // Second claim with same signature should fail
      await expect(
        pointsRedemption.connect(user).claim(eventId, claimAmount, claimNonce, signature),
      ).to.be.revertedWith('Claim already used');
    });

    it('Should not allow claiming before start time', async function () {
      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, claimAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, claimAmount, claimNonce, signature),
      ).to.be.revertedWith('Event not started');
    });

    it('Should not allow claiming below minimum limit', async function () {
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const belowMinAmount = minLimit / 2n; // Half of minimum limit
      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, belowMinAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, belowMinAmount, claimNonce, signature),
      ).to.be.revertedWith('Below minimum limit');
    });

    it('Should not allow claiming above maximum limit', async function () {
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const aboveMaxAmount = maxLimit + ethers.parseEther('0.1'); // Slightly above max limit
      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, aboveMaxAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, aboveMaxAmount, claimNonce, signature),
      ).to.be.revertedWith('Exceeds maximum limit');
    });

    it('Should not allow claiming with invalid signature', async function () {
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, claimAmount, claimNonce],
      );
      // Sign with wrong signer
      const signature = await owner.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, claimAmount, claimNonce, signature),
      ).to.be.revertedWith('Invalid signature');
    });
  });

  describe('Claiming ERC20', function () {
    const eventId = 2;
    const totalAmount = ethers.parseEther('1000');
    const claimAmount = ethers.parseEther('100');
    const startTime = async () => {
      const currentBlock = await ethers.provider.getBlock('latest');
      return (currentBlock?.timestamp || Math.floor(Date.now() / 1000)) + 60;
    };
    const minLimit = ethers.parseEther('10');
    const maxLimit = ethers.parseEther('200');

    beforeEach(async function () {
      // Setup ERC20 redemption event
      await mockToken.mint(owner.address, totalAmount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), totalAmount);

      await pointsRedemption
        .connect(owner)
        .createRedemptionEvent(
          eventId,
          await mockToken.getAddress(),
          totalAmount,
          await startTime(),
          minLimit,
          maxLimit,
        );
    });

    it('Should successfully claim ERC20 tokens with valid signature', async function () {
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, claimAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, claimAmount, claimNonce, signature),
      )
        .to.emit(pointsRedemption, 'TokensClaimed')
        .withArgs(eventId, user.address, claimAmount, claimNonce);

      expect(await mockToken.balanceOf(user.address)).to.equal(claimAmount);
    });

    it('Should not allow claiming before start time', async function () {
      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, claimAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, claimAmount, claimNonce, signature),
      ).to.be.revertedWith('Event not started');
    });

    it('Should not allow claiming below minimum limit', async function () {
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const belowMinAmount = minLimit / 2n; // Half of minimum limit
      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, belowMinAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, belowMinAmount, claimNonce, signature),
      ).to.be.revertedWith('Below minimum limit');
    });

    it('Should not allow claiming above maximum limit', async function () {
      await ethers.provider.send('evm_setNextBlockTimestamp', [(await startTime()) + 1]);
      await ethers.provider.send('evm_mine', []);

      const aboveMaxAmount = maxLimit + ethers.parseEther('10'); // Above max limit
      const claimNonce = 1;
      const message = ethers.solidityPackedKeccak256(
        ['uint256', 'address', 'uint256', 'uint256'],
        [eventId, user.address, aboveMaxAmount, claimNonce],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, aboveMaxAmount, claimNonce, signature),
      ).to.be.revertedWith('Exceeds maximum limit');
    });
  });
});
