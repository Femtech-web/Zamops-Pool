// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ConfidentialPrizePool} from "./ConfidentialPrizePool.sol";
import {IConfidentialTokenRegistry} from "./interfaces/IConfidentialTokenRegistry.sol";

/// @notice Creates exactly one independent shared prize pool per registry-valid confidential token.
contract ZamOpsPoolFactory {
    IConfidentialTokenRegistry public immutable registry;
    uint48 public immutable drawInterval;

    mapping(address confidentialToken => address pool) public poolByAsset;
    address[] private _pools;

    error InvalidRegistry();
    error AssetNotRegistryValid();
    error PoolAlreadyExists(address asset, address pool);

    event PoolCreated(address indexed confidentialToken, address indexed pool);

    constructor(address registryAddress, uint48 drawIntervalSeconds) {
        if (registryAddress == address(0)) revert InvalidRegistry();
        registry = IConfidentialTokenRegistry(registryAddress);
        drawInterval = drawIntervalSeconds;
    }

    function createPool(address confidentialToken) external returns (address pool) {
        if (!registry.isConfidentialTokenValid(confidentialToken)) revert AssetNotRegistryValid();
        address existing = poolByAsset[confidentialToken];
        if (existing != address(0)) revert PoolAlreadyExists(confidentialToken, existing);

        pool = address(new ConfidentialPrizePool(address(registry), confidentialToken, drawInterval));
        poolByAsset[confidentialToken] = pool;
        _pools.push(pool);
        emit PoolCreated(confidentialToken, pool);
    }

    function poolCount() external view returns (uint256) {
        return _pools.length;
    }

    function poolAt(uint256 index) external view returns (address) {
        return _pools[index];
    }
}
