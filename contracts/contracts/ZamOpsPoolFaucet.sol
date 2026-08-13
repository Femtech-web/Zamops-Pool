// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Allowlisted Sepolia test-token faucet supporting direct and gas-sponsored claims.
contract ZamOpsPoolFaucet is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant CLAIM_COOLDOWN = 1 days;

    struct FaucetToken {
        IERC20 token;
        uint256 claimAmount;
        bool enabled;
    }

    mapping(address token => FaucetToken config) private _tokens;
    mapping(address token => mapping(address account => uint256 timestamp)) public lastClaimAt;
    mapping(address account => bool enabled) public relayers;

    error FaucetTokenNotEnabled(address token);
    error FaucetClaimOnCooldown(address token, address account, uint256 nextClaimAt);
    error FaucetInventoryTooLow(address token, uint256 required, uint256 available);
    error FaucetInvalidAccount();
    error FaucetUnauthorizedRelayer(address account);

    event FaucetTokenConfigured(address indexed token, uint256 claimAmount, bool enabled);
    event FaucetRelayerConfigured(address indexed account, bool enabled);
    event Claimed(address indexed token, address indexed account, uint256 amount, uint256 nextClaimAt);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyRelayerOrOwner() {
        if (msg.sender != owner() && !relayers[msg.sender]) revert FaucetUnauthorizedRelayer(msg.sender);
        _;
    }

    function configureToken(IERC20 token, uint256 claimAmount, bool enabled) external onlyOwner {
        _tokens[address(token)] = FaucetToken(token, claimAmount, enabled);
        emit FaucetTokenConfigured(address(token), claimAmount, enabled);
    }

    function configureRelayer(address account, bool enabled) external onlyOwner {
        if (account == address(0)) revert FaucetInvalidAccount();
        relayers[account] = enabled;
        emit FaucetRelayerConfigured(account, enabled);
    }

    function claim(address tokenAddress) external {
        _claim(msg.sender, tokenAddress);
    }

    function claimFor(address account, address tokenAddress) external onlyRelayerOrOwner {
        _claim(account, tokenAddress);
    }

    function getFaucetToken(address tokenAddress) external view returns (FaucetToken memory) {
        return _tokens[tokenAddress];
    }

    function getClaimStatus(
        address tokenAddress,
        address account
    ) external view returns (uint256 claimAmount, bool enabled, uint256 lastClaim, uint256 nextClaimAt, bool canClaim) {
        FaucetToken memory config = _tokens[tokenAddress];
        lastClaim = lastClaimAt[tokenAddress][account];
        nextClaimAt = lastClaim == 0 ? 0 : lastClaim + CLAIM_COOLDOWN;
        canClaim = config.enabled && (lastClaim == 0 || block.timestamp >= nextClaimAt);
        return (config.claimAmount, config.enabled, lastClaim, nextClaimAt, canClaim);
    }

    function _claim(address account, address tokenAddress) private {
        if (account == address(0)) revert FaucetInvalidAccount();
        FaucetToken memory config = _tokens[tokenAddress];
        if (!config.enabled) revert FaucetTokenNotEnabled(tokenAddress);

        uint256 nextClaimAt = lastClaimAt[tokenAddress][account] + CLAIM_COOLDOWN;
        if (lastClaimAt[tokenAddress][account] != 0 && block.timestamp < nextClaimAt) {
            revert FaucetClaimOnCooldown(tokenAddress, account, nextClaimAt);
        }

        lastClaimAt[tokenAddress][account] = block.timestamp;
        _mintOrTransfer(config.token, account, config.claimAmount);
        emit Claimed(tokenAddress, account, config.claimAmount, block.timestamp + CLAIM_COOLDOWN);
    }

    function _mintOrTransfer(IERC20 token, address account, uint256 amount) private {
        uint256 balanceBefore = token.balanceOf(account);
        (bool minted, bytes memory returnData) = address(token).call(
            abi.encodeWithSignature("mint(address,uint256)", account, amount)
        );
        bool mintCallSucceeded = minted &&
            (returnData.length == 0 || (returnData.length == 32 && abi.decode(returnData, (bool))));
        if (mintCallSucceeded && token.balanceOf(account) >= balanceBefore + amount) return;

        uint256 available = token.balanceOf(address(this));
        if (available < amount) revert FaucetInventoryTooLow(address(token), amount, available);
        token.safeTransfer(account, amount);
    }
}
