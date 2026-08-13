// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockFaucetToken is ERC20 {
    bool public immutable publicMint;

    constructor(bool publicMint_) ERC20("Mock Faucet Token", "MFT") {
        publicMint = publicMint_;
    }

    function mint(address to, uint256 amount) external returns (bool) {
        require(publicMint, "restricted mint");
        _mint(to, amount);
        return true;
    }

    function seed(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
