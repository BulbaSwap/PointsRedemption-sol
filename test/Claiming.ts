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

    factory = await ethers.getContractFactory('PointsRedemption');
    const contract = await upgrades.deployProxy(factory, [globalSigner], {
      initializer: 'initialize',
    });
    pointsRedemption = factory.attach(await contract.getAddress()) as PointsRedemption;

    const MockERC20Factory = (await ethers.getContractFactory('MockERC20')) as MockERC20__factory;
    mockToken = (await MockERC20Factory.deploy()) as MockERC20;
  });

  describe('Claiming ETH', function () {
    const eventId = 1;
    const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    const totalAmount = ethers.parseEther('10');
    const claimAmount = ethers.parseEther('1');

    beforeEach(async function () {
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await pointsRedemption.connect(owner).addToken(eventId, ETH_ADDRESS, totalAmount, {
        value: totalAmount,
      });
    });

    it('Should successfully claim ETH with valid signature', async function () {
      const message = ethers.solidityPackedKeccak256(
        ['uint16', 'address', 'address', 'uint256'],
        [eventId, ETH_ADDRESS, user.address, claimAmount],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      const initialBalance = await ethers.provider.getBalance(user.address);

      await expect(
        pointsRedemption.connect(user).claim(eventId, ETH_ADDRESS, claimAmount, signature),
      )
        .to.emit(pointsRedemption, 'TokensClaimed')
        .withArgs(eventId, ETH_ADDRESS, user.address, claimAmount);

      const finalBalance = await ethers.provider.getBalance(user.address);
      expect(finalBalance - initialBalance).to.be.closeTo(claimAmount, ethers.parseEther('0.01'));
    });

    it('Should not allow duplicate claims with same signature', async function () {
      const message = ethers.solidityPackedKeccak256(
        ['uint16', 'address', 'address', 'uint256'],
        [eventId, ETH_ADDRESS, user.address, claimAmount],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await pointsRedemption.connect(user).claim(eventId, ETH_ADDRESS, claimAmount, signature);

      await expect(
        pointsRedemption.connect(user).claim(eventId, ETH_ADDRESS, claimAmount, signature),
      ).to.be.revertedWith('Claim already used');
    });

    it('Should not allow claiming with invalid signature', async function () {
      const message = ethers.solidityPackedKeccak256(
        ['uint16', 'address', 'address', 'uint256'],
        [eventId, ETH_ADDRESS, user.address, claimAmount],
      );
      const signature = await owner.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption.connect(user).claim(eventId, ETH_ADDRESS, claimAmount, signature),
      ).to.be.revertedWith('Invalid signature');
    });

    it('Should mark signature as used after successful claim', async function () {
      const message = ethers.solidityPackedKeccak256(
        ['uint16', 'address', 'address', 'uint256'],
        [eventId, ETH_ADDRESS, user.address, claimAmount],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await pointsRedemption.connect(user).claim(eventId, ETH_ADDRESS, claimAmount, signature);

      // Check if signature is marked as used
      const messageHash = ethers.solidityPackedKeccak256(
        ['uint16', 'address', 'address', 'uint256'],
        [eventId, ETH_ADDRESS, user.address, claimAmount],
      );
      expect(await pointsRedemption.usedSignatures(messageHash)).to.be.true;
    });
  });

  describe('Claiming ERC20', function () {
    const eventId = 2;
    const totalAmount = ethers.parseEther('1000');
    const claimAmount = ethers.parseEther('100');

    beforeEach(async function () {
      await mockToken.mint(owner.address, totalAmount);
      await mockToken.connect(owner).approve(pointsRedemption.getAddress(), totalAmount);
      await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
      await pointsRedemption
        .connect(owner)
        .addToken(eventId, await mockToken.getAddress(), totalAmount);
    });

    it('Should successfully claim ERC20 tokens with valid signature', async function () {
      const message = ethers.solidityPackedKeccak256(
        ['uint16', 'address', 'address', 'uint256'],
        [eventId, await mockToken.getAddress(), user.address, claimAmount],
      );
      const signature = await signer.signMessage(ethers.getBytes(message));

      await expect(
        pointsRedemption
          .connect(user)
          .claim(eventId, await mockToken.getAddress(), claimAmount, signature),
      )
        .to.emit(pointsRedemption, 'TokensClaimed')
        .withArgs(eventId, await mockToken.getAddress(), user.address, claimAmount);

      expect(await mockToken.balanceOf(user.address)).to.equal(claimAmount);
    });
  });

  describe('Claiming and Withdrawing', function () {
    describe('ETH', function () {
      const eventId = 3;
      const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
      const totalAmount = ethers.parseEther('10');
      const claimAmount = ethers.parseEther('1');

      beforeEach(async function () {
        await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
        await pointsRedemption.connect(owner).addToken(eventId, ETH_ADDRESS, totalAmount, {
          value: totalAmount,
        });
      });

      it('Should withdraw correct remaining ETH after claims', async function () {
        const message = ethers.solidityPackedKeccak256(
          ['uint16', 'address', 'address', 'uint256'],
          [eventId, ETH_ADDRESS, user.address, claimAmount],
        );
        const signature = await signer.signMessage(ethers.getBytes(message));
        await pointsRedemption.connect(user).claim(eventId, ETH_ADDRESS, claimAmount, signature);

        await pointsRedemption.connect(owner).createRedemptionEvent(eventId + 1);

        const [, , remainingAmount] = await pointsRedemption.getTokenInfo(eventId, ETH_ADDRESS);
        expect(remainingAmount).to.equal(totalAmount - claimAmount);

        const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
        await pointsRedemption.connect(owner).withdrawRemainingToken(eventId, ETH_ADDRESS);
        const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.closeTo(
          totalAmount - claimAmount,
          ethers.parseEther('0.01'),
        );
      });
    });

    describe('ERC20', function () {
      const eventId = 4;
      const totalAmount = ethers.parseEther('1000');
      const claimAmount = ethers.parseEther('100');

      beforeEach(async function () {
        await mockToken.mint(owner.address, totalAmount);
        await mockToken.connect(owner).approve(pointsRedemption.getAddress(), totalAmount);
        await pointsRedemption.connect(owner).createRedemptionEvent(eventId);
        await pointsRedemption
          .connect(owner)
          .addToken(eventId, await mockToken.getAddress(), totalAmount);
      });

      it('Should withdraw correct remaining ERC20 tokens after claims', async function () {
        const message = ethers.solidityPackedKeccak256(
          ['uint16', 'address', 'address', 'uint256'],
          [eventId, await mockToken.getAddress(), user.address, claimAmount],
        );
        const signature = await signer.signMessage(ethers.getBytes(message));
        await pointsRedemption
          .connect(user)
          .claim(eventId, await mockToken.getAddress(), claimAmount, signature);

        await pointsRedemption.connect(owner).createRedemptionEvent(eventId + 1);

        const [, , remainingAmount] = await pointsRedemption.getTokenInfo(
          eventId,
          await mockToken.getAddress(),
        );
        expect(remainingAmount).to.equal(totalAmount - claimAmount);

        const ownerBalanceBefore = await mockToken.balanceOf(owner.address);
        await pointsRedemption
          .connect(owner)
          .withdrawRemainingToken(eventId, await mockToken.getAddress());
        const ownerBalanceAfter = await mockToken.balanceOf(owner.address);

        expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(totalAmount - claimAmount);
      });
    });
  });
});
