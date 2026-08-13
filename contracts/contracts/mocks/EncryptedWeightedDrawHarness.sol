// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {EncryptedWeightedDrawSpike} from "../EncryptedWeightedDrawSpike.sol";

/// @dev Test-only harness for deterministic weighted-boundary and retry tests.
contract EncryptedWeightedDrawHarness is EncryptedWeightedDrawSpike {
    uint64 private _forcedTarget;
    bool private _forceInvalid;

    function configureSample(uint64 target, bool forceInvalid) external {
        _forcedTarget = target;
        _forceInvalid = forceInvalid;
    }

    function _sampleTarget(uint64, uint64 clearTotal) internal override returns (euint64, ebool) {
        euint64 target = FHE.asEuint64(_forcedTarget);
        ebool valid = _forceInvalid ? FHE.asEbool(false) : FHE.lt(target, clearTotal);
        return (target, valid);
    }
}
