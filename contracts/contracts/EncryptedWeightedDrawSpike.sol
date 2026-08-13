// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Encrypted weighted draw spike
/// @notice Proves private weight accounting and an unbiased, deposit-weighted draw.
/// @dev This is deliberately not the production pool: it records encrypted weights but does
///      not yet custody ERC-7984 tokens. The production pool will compose this draw mechanism
///      with confidential token transfers, principal withdrawals, and a funded prize reserve.
contract EncryptedWeightedDrawSpike is ZamaEthereumConfig {
    enum DrawState {
        Open,
        AwaitingTotalDecryption,
        Selecting,
        AwaitingResultDecryption,
        Complete
    }

    uint16 public constant MAX_PARTICIPANTS = 64;
    uint16 public constant MAX_BATCH_SIZE = 8;
    uint8 public constant RANDOM_CANDIDATE_COUNT = 8;
    uint64 public constant SPIKE_PRIZE_UNITS = 1;
    uint64 public constant MAX_SUPPORTED_TOTAL = uint64(1) << 63;

    DrawState public state;
    uint64 public revealedTotalWeight;
    uint16 public selectionCursor;
    uint32 public retryCount;

    address[] private _participants;
    mapping(address participant => bool registered) private _registered;
    mapping(address participant => euint64 weight) private _weights;
    mapping(address participant => euint64 winnings) private _winnings;

    euint64 private _totalWeight;
    euint64 private _snapshotTotalWeight;
    euint64 private _target;
    euint64 private _cumulativeWeight;
    ebool private _candidateValid;
    ebool private _winnerFound;

    error DrawNotOpen();
    error InvalidDrawState(DrawState expected, DrawState actual);
    error InvalidDecryptionHandle();
    error InvalidBatchSize();
    error NoParticipants();
    error ParticipantLimitReached();
    error EmptyPool();
    error TotalWeightTooLarge(uint64 totalWeight);

    event EncryptedWeightRecorded(address indexed participant);
    event TotalDecryptionRequested(bytes32 indexed encryptedTotalHandle);
    event SelectionStarted(uint64 revealedTotalWeight, uint64 randomUpperBound, uint32 retryCount);
    event SelectionBatchProcessed(uint16 indexed fromIndex, uint16 indexed toIndex);
    event ResultDecryptionRequested(bytes32 indexed encryptedWinnerFoundHandle);
    event DrawRetryStarted(uint32 indexed retryCount);
    event DrawCompleted();

    constructor() {
        state = DrawState.Open;
        _totalWeight = FHE.asEuint64(0);
        FHE.allowThis(_totalWeight);
    }

    /// @notice Records a participant's encrypted draw weight.
    /// @dev No token transfer occurs in this spike contract.
    function recordEncryptedWeight(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        if (state != DrawState.Open) revert DrawNotOpen();

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        if (!_registered[msg.sender]) {
            if (_participants.length >= MAX_PARTICIPANTS) revert ParticipantLimitReached();
            _registered[msg.sender] = true;
            _participants.push(msg.sender);
            _weights[msg.sender] = FHE.asEuint64(0);
            _winnings[msg.sender] = FHE.asEuint64(0);
        }

        _weights[msg.sender] = FHE.add(_weights[msg.sender], amount);
        _totalWeight = FHE.add(_totalWeight, amount);

        FHE.allowThis(_weights[msg.sender]);
        FHE.allow(_weights[msg.sender], msg.sender);
        FHE.allowThis(_winnings[msg.sender]);
        FHE.allow(_winnings[msg.sender], msg.sender);
        FHE.allowThis(_totalWeight);

        emit EncryptedWeightRecorded(msg.sender);
    }

    /// @notice Freezes deposits and requests public decryption of only the aggregate weight.
    function requestDraw() external {
        if (state != DrawState.Open) revert InvalidDrawState(DrawState.Open, state);
        if (_participants.length == 0) revert NoParticipants();

        _snapshotTotalWeight = _totalWeight;
        FHE.allowThis(_snapshotTotalWeight);
        FHE.makePubliclyDecryptable(_snapshotTotalWeight);
        state = DrawState.AwaitingTotalDecryption;

        emit TotalDecryptionRequested(FHE.toBytes32(_snapshotTotalWeight));
    }

    /// @notice Verifies the aggregate decryption and creates encrypted random candidates.
    function startSelection(
        bytes32[] calldata handlesList,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external {
        if (state != DrawState.AwaitingTotalDecryption) {
            revert InvalidDrawState(DrawState.AwaitingTotalDecryption, state);
        }
        _requireExpectedHandle(handlesList, FHE.toBytes32(_snapshotTotalWeight));
        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        uint64 clearTotal = abi.decode(abiEncodedCleartexts, (uint64));
        if (clearTotal == 0) revert EmptyPool();
        if (clearTotal > MAX_SUPPORTED_TOTAL) revert TotalWeightTooLarge(clearTotal);

        revealedTotalWeight = clearTotal;
        _beginSelection(clearTotal);
    }

    /// @notice Processes at most eight public participant addresses in encrypted space.
    function processSelectionBatch(uint16 requestedBatchSize) external {
        if (state != DrawState.Selecting) revert InvalidDrawState(DrawState.Selecting, state);
        if (requestedBatchSize == 0 || requestedBatchSize > MAX_BATCH_SIZE) revert InvalidBatchSize();

        uint16 start = selectionCursor;
        uint256 proposedEnd = uint256(start) + requestedBatchSize;
        uint16 end = proposedEnd < _participants.length ? uint16(proposedEnd) : uint16(_participants.length);

        euint64 encryptedPrize = FHE.asEuint64(SPIKE_PRIZE_UNITS);
        euint64 encryptedZero = FHE.asEuint64(0);

        for (uint16 index = start; index < end; ++index) {
            address participant = _participants[index];
            _cumulativeWeight = FHE.add(_cumulativeWeight, _weights[participant]);

            ebool targetInsidePrefix = FHE.lt(_target, _cumulativeWeight);
            ebool firstMatch = FHE.and(FHE.not(_winnerFound), targetInsidePrefix);
            ebool wins = FHE.and(_candidateValid, firstMatch);
            euint64 award = FHE.select(wins, encryptedPrize, encryptedZero);

            _winnings[participant] = FHE.add(_winnings[participant], award);
            _winnerFound = FHE.or(_winnerFound, wins);

            FHE.allowThis(_cumulativeWeight);
            FHE.allowThis(_winnings[participant]);
            FHE.allow(_winnings[participant], participant);
            FHE.allowThis(_winnerFound);
        }

        selectionCursor = end;
        emit SelectionBatchProcessed(start, end);

        if (end == _participants.length) {
            FHE.makePubliclyDecryptable(_winnerFound);
            state = DrawState.AwaitingResultDecryption;
            emit ResultDecryptionRequested(FHE.toBytes32(_winnerFound));
        }
    }

    /// @notice Verifies whether the encrypted scan selected a winner.
    /// @dev A false result means every random candidate was outside the exact total range.
    ///      Since no award was applied in that case, the contract safely samples again.
    function finalizeSelection(
        bytes32[] calldata handlesList,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external {
        if (state != DrawState.AwaitingResultDecryption) {
            revert InvalidDrawState(DrawState.AwaitingResultDecryption, state);
        }
        _requireExpectedHandle(handlesList, FHE.toBytes32(_winnerFound));
        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        bool clearWinnerFound = abi.decode(abiEncodedCleartexts, (bool));
        if (!clearWinnerFound) {
            unchecked {
                ++retryCount;
            }
            emit DrawRetryStarted(retryCount);
            _beginSelection(revealedTotalWeight);
            return;
        }

        state = DrawState.Complete;
        emit DrawCompleted();
    }

    function encryptedWeightOf(address participant) external view returns (euint64) {
        return _weights[participant];
    }

    function encryptedWinningsOf(address participant) external view returns (euint64) {
        return _winnings[participant];
    }

    function totalWeightHandle() external view returns (bytes32) {
        return FHE.toBytes32(_snapshotTotalWeight);
    }

    function resultHandle() external view returns (bytes32) {
        return FHE.toBytes32(_winnerFound);
    }

    function participantCount() external view returns (uint256) {
        return _participants.length;
    }

    function participantAt(uint256 index) external view returns (address) {
        return _participants[index];
    }

    function _beginSelection(uint64 clearTotal) internal {
        uint64 upperBound = _nextPowerOfTwo(clearTotal);
        (_target, _candidateValid) = _sampleTarget(upperBound, clearTotal);
        _cumulativeWeight = FHE.asEuint64(0);
        _winnerFound = FHE.asEbool(false);
        selectionCursor = 0;
        state = DrawState.Selecting;

        FHE.allowThis(_target);
        FHE.allowThis(_candidateValid);
        FHE.allowThis(_cumulativeWeight);
        FHE.allowThis(_winnerFound);

        emit SelectionStarted(clearTotal, upperBound, retryCount);
    }

    /// @dev Selects the first of eight encrypted random candidates below clearTotal.
    ///      Each accepted value is uniform on [0, clearTotal), without modulo bias.
    function _sampleTarget(uint64 upperBound, uint64 clearTotal) internal virtual returns (euint64, ebool) {
        euint64 selected = FHE.asEuint64(0);
        ebool found = FHE.asEbool(false);

        for (uint8 index = 0; index < RANDOM_CANDIDATE_COUNT; ++index) {
            euint64 candidate = FHE.randEuint64(upperBound);
            ebool valid = FHE.lt(candidate, clearTotal);
            ebool choose = FHE.and(FHE.not(found), valid);
            selected = FHE.select(choose, candidate, selected);
            found = FHE.or(found, valid);
        }

        return (selected, found);
    }

    function _nextPowerOfTwo(uint64 value) internal pure returns (uint64) {
        if (value <= 1) return 1;
        unchecked {
            --value;
            value |= value >> 1;
            value |= value >> 2;
            value |= value >> 4;
            value |= value >> 8;
            value |= value >> 16;
            value |= value >> 32;
            return value + 1;
        }
    }

    function _requireExpectedHandle(bytes32[] calldata handlesList, bytes32 expectedHandle) internal pure {
        if (handlesList.length != 1 || handlesList[0] != expectedHandle) revert InvalidDecryptionHandle();
    }
}
