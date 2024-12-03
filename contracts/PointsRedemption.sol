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

    address constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    struct TokenInfo {
        address tokenAddress;
        uint256 totalAmount;
        uint256 remainingAmount;
        uint256 rate; // Multiplied by 1e18 for precision
    }

    struct RedemptionEvent {
        bool isActive;
        mapping(uint256 => TokenInfo) tokens; // tokenId => TokenInfo
        uint256 tokenCount;
    }

    struct TokenInfoView {
        address tokenAddress;
        uint256 totalAmount;
        uint256 remainingAmount;
        uint256 rate;
    }

    address public globalSigner;
    mapping(bytes32 => bool) public usedSignatures;
    mapping(uint256 => RedemptionEvent) public redemptionEvents;
    mapping(uint256 => mapping(address => uint256)) public userTotalRedeemed;

    event RedemptionEventCreated(uint256 indexed eventId);

    event TokenAdded(
        uint256 indexed eventId,
        uint256 indexed tokenId,
        address tokenAddress,
        uint256 totalAmount,
        uint256 rate
    );

    event TokensClaimed(
        uint256 indexed eventId,
        uint256 indexed tokenId,
        address indexed user,
        uint256 points,
        uint256 amount
    );

    event EventStatusUpdated(uint256 indexed eventId, bool isActive);
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

    function createRedemptionEvent(uint256 eventId) external onlyOwner {
        require(redemptionEvents[eventId].tokenCount == 0, "Event already exists");

        // Deactivate previous event if exists
        if (eventId > 0) {
            redemptionEvents[eventId - 1].isActive = false;
            emit EventStatusUpdated(eventId - 1, false);
        }

        RedemptionEvent storage newEvent = redemptionEvents[eventId];
        newEvent.isActive = true;

        emit RedemptionEventCreated(eventId);
    }

    function addToken(
        uint256 eventId,
        uint256 tokenId,
        address tokenAddress,
        uint256 totalAmount,
        uint256 rate
    ) external payable onlyOwner {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        require(event_.isActive, "Event not active");
        require(event_.tokens[tokenId].tokenAddress == address(0), "Token already added");

        if (tokenAddress == ETH) {
            require(msg.value == totalAmount, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not accepted for tokens");
            IERC20(tokenAddress).transferFrom(msg.sender, address(this), totalAmount);
        }

        event_.tokens[tokenId] = TokenInfo({
            tokenAddress: tokenAddress,
            totalAmount: totalAmount,
            remainingAmount: totalAmount,
            rate: rate
        });
        event_.tokenCount++;

        emit TokenAdded(eventId, tokenId, tokenAddress, totalAmount, rate);
    }

    function claim(
        uint256 eventId,
        uint256 tokenId,
        uint256 points,
        uint256 amount,
        bytes memory signature
    ) external nonReentrant {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        require(event_.isActive, "Event not active");
        TokenInfo storage token = event_.tokens[tokenId];
        require(token.tokenAddress != address(0), "Token not found");

        bytes32 messageHash = keccak256(
            abi.encodePacked(eventId, tokenId, msg.sender, points, amount)
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedMessageHash.recover(signature);

        require(recoveredSigner == globalSigner, "Invalid signature");
        require(!usedSignatures[messageHash], "Claim already used");
        require(token.remainingAmount >= amount, "Insufficient remaining amount");

        uint256 newTotal = userTotalRedeemed[eventId][msg.sender] + points;

        usedSignatures[messageHash] = true;
        userTotalRedeemed[eventId][msg.sender] = newTotal;
        token.remainingAmount -= amount;

        if (token.tokenAddress == ETH) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token.tokenAddress).transfer(msg.sender, amount);
        }

        emit TokensClaimed(eventId, tokenId, msg.sender, points, amount);
    }

    function withdrawRemainingToken(uint256 eventId, uint256 tokenId) external onlyOwner {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        TokenInfo storage token = event_.tokens[tokenId];
        require(token.tokenAddress != address(0), "Token not found");
        require(!event_.isActive, "Event still active");

        uint256 amount = token.remainingAmount;
        require(amount > 0, "No remaining amount");

        token.remainingAmount = 0;

        if (token.tokenAddress == ETH) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token.tokenAddress).transfer(msg.sender, amount);
        }
    }

    function withdrawEventTokens(uint256 eventId) external onlyOwner {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        require(!event_.isActive, "Event still active");
        require(event_.tokenCount > 0, "No tokens in event");

        for (uint256 i = 0; i < event_.tokenCount; i++) {
            TokenInfo storage token = event_.tokens[i];
            if (token.remainingAmount > 0) {
                uint256 amount = token.remainingAmount;
                token.remainingAmount = 0;

                if (token.tokenAddress == ETH) {
                    (bool success, ) = msg.sender.call{value: amount}("");
                    require(success, "ETH transfer failed");
                } else {
                    IERC20(token.tokenAddress).transfer(msg.sender, amount);
                }
            }
        }
    }

    function withdrawAllTokensInRange(uint256 startEventId, uint256 endEventId) external onlyOwner {
        require(startEventId <= endEventId, "Invalid range");

        for (uint256 eventId = startEventId; eventId <= endEventId; eventId++) {
            RedemptionEvent storage event_ = redemptionEvents[eventId];

            // Skip if event doesn't exist or is active
            if (event_.tokenCount == 0 || event_.isActive) {
                continue;
            }

            for (uint256 tokenId = 0; tokenId < event_.tokenCount; tokenId++) {
                TokenInfo storage token = event_.tokens[tokenId];
                if (token.remainingAmount > 0) {
                    uint256 amount = token.remainingAmount;
                    token.remainingAmount = 0;

                    if (token.tokenAddress == ETH) {
                        (bool success, ) = msg.sender.call{value: amount}("");
                        require(success, "ETH transfer failed");
                    } else {
                        IERC20(token.tokenAddress).transfer(msg.sender, amount);
                    }
                }
            }
        }
    }

    function getTokenInfo(
        uint256 eventId,
        uint256 tokenId
    )
        external
        view
        returns (address tokenAddress, uint256 totalAmount, uint256 remainingAmount, uint256 rate)
    {
        TokenInfo storage token = redemptionEvents[eventId].tokens[tokenId];
        return (token.tokenAddress, token.totalAmount, token.remainingAmount, token.rate);
    }

    function getEventInfo(
        uint256 eventId
    ) external view returns (bool isActive, uint256 tokenCount, TokenInfoView[] memory tokens) {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        tokens = new TokenInfoView[](event_.tokenCount);

        for (uint256 i = 0; i < event_.tokenCount; i++) {
            TokenInfo storage token = event_.tokens[i];
            tokens[i] = TokenInfoView({
                tokenAddress: token.tokenAddress,
                totalAmount: token.totalAmount,
                remainingAmount: token.remainingAmount,
                rate: token.rate
            });
        }

        return (event_.isActive, event_.tokenCount, tokens);
    }
}
