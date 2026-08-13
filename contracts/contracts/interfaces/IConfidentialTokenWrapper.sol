// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

interface IConfidentialTokenWrapper is IERC7984 {
    function wrap(address to, uint256 amount) external returns (euint64);
    function underlying() external view returns (address);
    function rate() external view returns (uint256);
}
