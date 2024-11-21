// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PointsRedemption is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct RedemptionEvent {
        address tokenAddress;
        uint256 totalAmount;
        uint256 scheduledStartTime;
        uint256 minLimitPerAddress;
        uint256 maxLimitPerAddress;
    }

    address public globalSigner;
    mapping(bytes32 => bool) public usedSignatures;
    mapping(uint256 => RedemptionEvent) public redemptionEvents;
    mapping(uint256 => mapping(address => uint256)) public userTotalRedeemed;

    event RedemptionEventCreated(
        uint256 indexed eventId,
        address tokenAddress,
        uint256 totalAmount,
        uint256 scheduledStartTime
    );
    event TokensClaimed(
        uint256 indexed eventId,
        address indexed user,
        uint256 amount,
        uint256 claimNonce
    );
    event GlobalSignerUpdated(address indexed newSigner);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _globalSigner) public initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        globalSigner = _globalSigner;
    }

    function setGlobalSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Invalid signer address");
        globalSigner = _newSigner;
        emit GlobalSignerUpdated(_newSigner);
    }

    function createRedemptionEvent(
        uint256 eventId,
        address tokenAddress,
        uint256 totalAmount,
        uint256 scheduledStartTime,
        uint256 minLimitPerAddress,
        uint256 maxLimitPerAddress
    ) external payable onlyOwner {
        require(redemptionEvents[eventId].tokenAddress == address(0), "Event already exists");
        require(scheduledStartTime > block.timestamp, "Start time must be in future");
        require(maxLimitPerAddress >= minLimitPerAddress, "Invalid limits");

        if (tokenAddress == address(0)) {
            // ETH case
            require(msg.value == totalAmount, "Incorrect ETH amount sent");
        } else {
            // ERC20 case
            require(msg.value == 0, "ETH not accepted for ERC20 events");
            IERC20(tokenAddress).transferFrom(msg.sender, address(this), totalAmount);
        }

        redemptionEvents[eventId] = RedemptionEvent({
            tokenAddress: tokenAddress,
            totalAmount: totalAmount,
            scheduledStartTime: scheduledStartTime,
            minLimitPerAddress: minLimitPerAddress,
            maxLimitPerAddress: maxLimitPerAddress
        });
        emit RedemptionEventCreated(eventId, tokenAddress, totalAmount, scheduledStartTime);
    }

    function claim(
        uint256 eventId,
        uint256 amount,
        uint256 claimNonce,
        bytes memory signature
    ) external nonReentrant {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        require(event_.tokenAddress != address(0) || event_.totalAmount > 0, "Event not exists");
        require(block.timestamp >= event_.scheduledStartTime, "Event not started");

        bytes32 messageHash = keccak256(abi.encodePacked(eventId, msg.sender, amount, claimNonce));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ECDSA.recover(ethSignedMessageHash, signature);

        require(recoveredSigner == globalSigner, "Invalid signature");
        require(!usedSignatures[messageHash], "Claim already used");

        uint256 newTotal = userTotalRedeemed[eventId][msg.sender] + amount;
        require(newTotal >= event_.minLimitPerAddress, "Below minimum limit");
        require(newTotal <= event_.maxLimitPerAddress, "Exceeds maximum limit");

        usedSignatures[messageHash] = true;
        userTotalRedeemed[eventId][msg.sender] = newTotal;

        if (event_.tokenAddress == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(event_.tokenAddress).transfer(msg.sender, amount);
        }

        emit TokensClaimed(eventId, msg.sender, amount, claimNonce);
    }
}
