// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IConfidentialTokenRegistry} from "../interfaces/IConfidentialTokenRegistry.sol";

contract MockConfidentialTokenRegistry is IConfidentialTokenRegistry {
    mapping(address token => bool valid) public validity;

    function setValid(address token, bool valid) external {
        validity[token] = valid;
    }

    function isConfidentialTokenValid(address token) external view returns (bool) {
        return validity[token];
    }
}
