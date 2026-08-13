// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

contract MockConfidentialToken is ZamaEthereumConfig, ERC7984 {
    constructor() ERC7984("Confidential Test USD", "cTUSD", "https://pool.zamops.xyz") {}

    function mint(address to, uint64 amount) external {
        _mint(to, FHE.asEuint64(amount));
    }
}
