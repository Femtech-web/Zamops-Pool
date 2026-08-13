// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IConfidentialTokenRegistry {
    function isConfidentialTokenValid(address confidentialToken) external view returns (bool);
}
