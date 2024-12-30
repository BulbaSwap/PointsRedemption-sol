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
    }

    struct RedemptionEvent {
        bool isActive;
        mapping(address => TokenInfo) tokens; // tokenAddress => TokenInfo
        address[] tokenAddresses; // To keep track of added tokens
    }

    address public globalSigner;
    mapping(bytes32 => bool) public usedSignatures;
    mapping(uint16 => RedemptionEvent) public redemptionEvents;
    mapping(uint16 => mapping(address => uint256)) public userTotalRedeemed;

    event RedemptionEventCreated(uint16 indexed eventId);

    event TokenAdded(uint16 indexed eventId, address indexed tokenAddress, uint256 totalAmount);

    event TokensClaimed(
        uint16 indexed eventId,
        address indexed tokenAddress,
        address indexed user,
        uint256 amount
    );

    event EventStatusUpdated(uint16 indexed eventId, bool isActive);
    event GlobalSignerUpdated(address indexed newSigner);

    uint16 public currentEventId;

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

    function createRedemptionEvent(uint16 eventId) external onlyOwner {
        require(redemptionEvents[eventId].tokenAddresses.length == 0, "Event already exists");

        // Deactivate current event if exists
        if (currentEventId > 0) {
            redemptionEvents[currentEventId].isActive = false;
            emit EventStatusUpdated(currentEventId, false);
        }

        RedemptionEvent storage newEvent = redemptionEvents[eventId];
        newEvent.isActive = true;
        currentEventId = eventId;

        emit RedemptionEventCreated(eventId);
    }

    function addToken(
        uint16 eventId,
        address tokenAddress,
        uint256 totalAmount
    ) external payable onlyOwner {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        require(event_.isActive, "Event not active");
        require(event_.tokens[tokenAddress].tokenAddress == address(0), "Token already added");

        if (tokenAddress == ETH) {
            require(msg.value == totalAmount, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not accepted for tokens");
            IERC20(tokenAddress).transferFrom(msg.sender, address(this), totalAmount);
        }

        event_.tokens[tokenAddress] = TokenInfo({
            tokenAddress: tokenAddress,
            totalAmount: totalAmount,
            remainingAmount: totalAmount
        });
        event_.tokenAddresses.push(tokenAddress);

        emit TokenAdded(eventId, tokenAddress, totalAmount);
    }

    function claim(
        uint16 eventId,
        uint16 userRedemptionId,
        address tokenAddress,
        uint256 amount,
        bytes memory signature
    ) external nonReentrant {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        require(event_.isActive, "Event not active");
        TokenInfo storage token = event_.tokens[tokenAddress];
        require(token.tokenAddress != address(0), "Token not found");

        bytes32 messageHash = keccak256(
            abi.encodePacked(eventId, userRedemptionId, tokenAddress, msg.sender, amount)
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedMessageHash.recover(signature);

        require(recoveredSigner == globalSigner, "Invalid signature");
        require(!usedSignatures[messageHash], "Claim already used");
        require(token.remainingAmount >= amount, "Insufficient remaining amount");

        usedSignatures[messageHash] = true;
        token.remainingAmount -= amount;

        if (token.tokenAddress == ETH) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token.tokenAddress).transfer(msg.sender, amount);
        }

        emit TokensClaimed(eventId, tokenAddress, msg.sender, amount);
    }

    function withdrawRemainingToken(uint16 eventId, address tokenAddress) external onlyOwner {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        TokenInfo storage token = event_.tokens[tokenAddress];
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

    function withdrawEventTokens(uint16 eventId) external onlyOwner {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        require(!event_.isActive, "Event still active");
        require(event_.tokenAddresses.length > 0, "No tokens in event");

        for (uint256 i = 0; i < event_.tokenAddresses.length; i++) {
            address tokenAddress = event_.tokenAddresses[i];
            TokenInfo storage token = event_.tokens[tokenAddress];
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

    function withdrawAllTokensInRange(uint16 startEventId, uint16 endEventId) external onlyOwner {
        require(startEventId <= endEventId, "Invalid range");

        for (uint16 eventId = startEventId; eventId <= endEventId; eventId++) {
            RedemptionEvent storage event_ = redemptionEvents[eventId];

            // Skip if event doesn't exist or is active
            if (event_.tokenAddresses.length == 0 || event_.isActive) {
                continue;
            }

            for (uint256 i = 0; i < event_.tokenAddresses.length; i++) {
                address tokenAddress = event_.tokenAddresses[i];
                TokenInfo storage token = event_.tokens[tokenAddress];
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
        uint16 eventId,
        address tokenAddress
    ) external view returns (address _tokenAddress, uint256 totalAmount, uint256 remainingAmount) {
        TokenInfo storage token = redemptionEvents[eventId].tokens[tokenAddress];
        return (token.tokenAddress, token.totalAmount, token.remainingAmount);
    }

    function getEventInfo(
        uint16 eventId
    ) public view returns (bool isActive, uint256 tokenCount, TokenInfo[] memory tokens) {
        RedemptionEvent storage event_ = redemptionEvents[eventId];
        tokens = new TokenInfo[](event_.tokenAddresses.length);

        for (uint256 i = 0; i < event_.tokenAddresses.length; i++) {
            address tokenAddress = event_.tokenAddresses[i];
            TokenInfo storage token = event_.tokens[tokenAddress];
            tokens[i] = TokenInfo({
                tokenAddress: token.tokenAddress,
                totalAmount: token.totalAmount,
                remainingAmount: token.remainingAmount
            });
        }

        return (event_.isActive, event_.tokenAddresses.length, tokens);
    }

    function getCurrentEvent()
        external
        view
        returns (
            uint16 eventId,
            bool isActive,
            uint256 tokenCount,
            address[] memory tokenAddresses,
            TokenInfo[] memory tokens
        )
    {
        RedemptionEvent storage event_ = redemptionEvents[currentEventId];
        (isActive, tokenCount, tokens) = getEventInfo(currentEventId);

        return (currentEventId, isActive, tokenCount, event_.tokenAddresses, tokens);
    }

    function deactivateCurrentEvent() external onlyOwner {
        require(currentEventId > 0, "No current event");
        require(redemptionEvents[currentEventId].isActive, "Event already inactive");

        redemptionEvents[currentEventId].isActive = false;
        emit EventStatusUpdated(currentEventId, false);
    }

    function activateCurrentEvent() external onlyOwner {
        require(currentEventId > 0, "No current event");
        require(!redemptionEvents[currentEventId].isActive, "Event already active");

        redemptionEvents[currentEventId].isActive = true;
        emit EventStatusUpdated(currentEventId, true);
    }
}
