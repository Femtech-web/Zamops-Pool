// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IConfidentialTokenRegistry} from "./interfaces/IConfidentialTokenRegistry.sol";

/// @title ZamOps confidential prize pool
/// @notice A single-asset, no-loss prize-savings pool using ERC-7984 custody and FHE weighted draws.
contract ConfidentialPrizePool is ZamaEthereumConfig, ReentrancyGuard {
    enum DrawState {
        Open,
        AwaitingTotalDecryption,
        Selecting,
        AwaitingResultDecryption,
        Syncing
    }

    uint16 public constant MAX_PARTICIPANTS = 64;
    uint16 public constant MAX_BATCH_SIZE = 8;
    uint8 public constant RANDOM_CANDIDATE_COUNT = 8;
    uint64 public constant MAX_SUPPORTED_TOTAL = uint64(1) << 63;

    IERC7984 public immutable asset;
    IConfidentialTokenRegistry public immutable registry;
    uint48 public immutable drawInterval;

    DrawState public state;
    uint64 public revealedTotalWeight;
    uint64 public nextDrawAt;
    uint64 public drawId;
    uint64 public completedDraws;
    uint16 public selectionCursor;
    uint16 public syncCursor;
    uint32 public retryCount;

    address[] private _participants;
    mapping(address participant => uint16 indexPlusOne) private _participantIndexPlusOne;
    mapping(address participant => euint64 principal) private _principal;
    mapping(address participant => euint64 weight) private _eligibleWeight;
    mapping(address participant => euint64 winnings) private _winnings;

    euint64 private _totalEligibleWeight;
    euint64 private _nextTotalEligibleWeight;
    euint64 private _snapshotTotalWeight;
    euint64 private _prizeReserve;
    euint64 private _drawPrize;
    euint64 private _target;
    euint64 private _cumulativeWeight;
    ebool private _candidateValid;
    ebool private _winnerFound;

    error InvalidAsset();
    error AssetNotRegistryValid();
    error DepositsClosed();
    error DrawTooEarly(uint64 nextDrawAt);
    error InvalidDrawState(DrawState expected, DrawState actual);
    error InvalidDecryptionHandle();
    error InvalidBatchSize();
    error NoParticipants();
    error ParticipantLimitReached();
    error TotalWeightTooLarge(uint64 totalWeight);

    /// @dev Amount handles are public transaction metadata but their values remain encrypted.
    /// The matching wallet receives FHE ACL permission and may decrypt its own amount through EIP-712.
    event EncryptedDeposit(address indexed participant, bytes32 indexed encryptedAmount);
    event EncryptedWithdrawal(address indexed participant, bytes32 indexed encryptedAmount);
    event EncryptedPrizeFunded(address indexed funder, bytes32 indexed encryptedAmount);
    event EncryptedPrizeClaimed(address indexed participant, bytes32 indexed encryptedAmount);
    event TotalDecryptionRequested(uint64 indexed drawId, bytes32 indexed encryptedTotalHandle);
    event SelectionStarted(uint64 indexed drawId, uint64 revealedTotalWeight, uint64 randomUpperBound, uint32 retryCount);
    event SelectionBatchProcessed(uint64 indexed drawId, uint16 indexed fromIndex, uint16 indexed toIndex);
    event ResultDecryptionRequested(uint64 indexed drawId, bytes32 indexed encryptedWinnerFoundHandle);
    event DrawRetryStarted(uint64 indexed drawId, uint32 indexed retryCount);
    event DrawCompleted(uint64 indexed drawId);
    event DrawCancelledEmpty(uint64 indexed drawId);
    event NextDrawSyncProcessed(uint16 indexed fromIndex, uint16 indexed toIndex);
    event PoolReopened(uint64 indexed drawId, uint64 nextDrawAt);

    constructor(address registryAddress, address assetAddress, uint48 drawIntervalSeconds) {
        if (registryAddress == address(0) || assetAddress == address(0)) revert InvalidAsset();
        registry = IConfidentialTokenRegistry(registryAddress);
        asset = IERC7984(assetAddress);
        if (!registry.isConfidentialTokenValid(assetAddress)) revert AssetNotRegistryValid();

        drawInterval = drawIntervalSeconds;
        drawId = 1;
        nextDrawAt = uint64(block.timestamp) + drawIntervalSeconds;
        state = DrawState.Open;

        _totalEligibleWeight = FHE.asEuint64(0);
        _prizeReserve = FHE.asEuint64(0);
        FHE.allowThis(_totalEligibleWeight);
        FHE.allowThis(_prizeReserve);
    }

    /// @notice Deposits the amount actually transferred by the ERC-7984 token.
    /// @dev The encrypted input and proof are created for this pool. The pool then grants the token transient access.
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external nonReentrant {
        if (state != DrawState.Open) revert DepositsClosed();
        if (!registry.isConfidentialTokenValid(address(asset))) revert AssetNotRegistryValid();

        _registerParticipant(msg.sender);
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 remainingCapacity = FHE.sub(MAX_SUPPORTED_TOTAL, _totalEligibleWeight);
        euint64 accepted = FHE.select(FHE.lt(requested, remainingCapacity), requested, remainingCapacity);
        FHE.allowTransient(accepted, address(asset));
        euint64 received = asset.confidentialTransferFrom(msg.sender, address(this), accepted);

        _principal[msg.sender] = FHE.add(_principal[msg.sender], received);
        _eligibleWeight[msg.sender] = FHE.add(_eligibleWeight[msg.sender], received);
        _totalEligibleWeight = FHE.add(_totalEligibleWeight, received);

        _allowUserValue(_principal[msg.sender], msg.sender);
        _allowStored(_eligibleWeight[msg.sender]);
        _allowStored(_totalEligibleWeight);
        _allowUserValue(received, msg.sender);
        emit EncryptedDeposit(msg.sender, FHE.toBytes32(received));
    }

    /// @notice Withdraws up to the caller's encrypted principal at any lifecycle stage.
    /// @dev The requested input is created for this pool. Current-draw odds remain frozen after requestDraw.
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external nonReentrant {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 principal = _initialized(_principal[msg.sender]);
        euint64 amount = FHE.select(FHE.lt(requested, principal), requested, principal);

        _principal[msg.sender] = FHE.sub(principal, amount);
        _allowUserValue(_principal[msg.sender], msg.sender);

        if (state == DrawState.Open) {
            _eligibleWeight[msg.sender] = FHE.sub(_initialized(_eligibleWeight[msg.sender]), amount);
            _totalEligibleWeight = FHE.sub(_totalEligibleWeight, amount);
            _allowStored(_eligibleWeight[msg.sender]);
            _allowStored(_totalEligibleWeight);
        } else if (state == DrawState.Syncing && _isAlreadySynced(msg.sender)) {
            _eligibleWeight[msg.sender] = FHE.sub(_eligibleWeight[msg.sender], amount);
            _nextTotalEligibleWeight = FHE.sub(_nextTotalEligibleWeight, amount);
            _allowStored(_eligibleWeight[msg.sender]);
            _allowStored(_nextTotalEligibleWeight);
        }

        _allowUserValue(amount, msg.sender);
        _transferAsset(msg.sender, amount);
        emit EncryptedWithdrawal(msg.sender, FHE.toBytes32(amount));
    }

    /// @notice Adds mock yield/prize liquidity without changing any participant's principal.
    /// @dev The encrypted input and proof are created for this pool; the pool grants the token transient access.
    function fundPrize(externalEuint64 encryptedAmount, bytes calldata inputProof) external nonReentrant {
        if (!registry.isConfidentialTokenValid(address(asset))) revert AssetNotRegistryValid();
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 received = asset.confidentialTransferFrom(msg.sender, address(this), requested);
        _prizeReserve = FHE.add(_prizeReserve, received);
        _allowStored(_prizeReserve);
        _allowUserValue(received, msg.sender);
        emit EncryptedPrizeFunded(msg.sender, FHE.toBytes32(received));
    }

    /// @notice Transfers the caller's entire encrypted winnings balance and resets it to zero.
    function claim() external nonReentrant {
        euint64 amount = _initialized(_winnings[msg.sender]);
        _winnings[msg.sender] = FHE.asEuint64(0);
        _allowUserValue(_winnings[msg.sender], msg.sender);
        _allowUserValue(amount, msg.sender);
        _transferAsset(msg.sender, amount);
        emit EncryptedPrizeClaimed(msg.sender, FHE.toBytes32(amount));
    }

    /// @notice Freezes encrypted draw weights/prize and requests aggregate-weight public decryption.
    function requestDraw() external {
        if (state != DrawState.Open) revert InvalidDrawState(DrawState.Open, state);
        if (block.timestamp < nextDrawAt) revert DrawTooEarly(nextDrawAt);
        if (_participants.length == 0) revert NoParticipants();

        _snapshotTotalWeight = _totalEligibleWeight;
        _drawPrize = _prizeReserve;
        _prizeReserve = FHE.asEuint64(0);
        _allowStored(_snapshotTotalWeight);
        _allowStored(_drawPrize);
        _allowStored(_prizeReserve);
        FHE.makePubliclyDecryptable(_snapshotTotalWeight);
        state = DrawState.AwaitingTotalDecryption;
        emit TotalDecryptionRequested(drawId, FHE.toBytes32(_snapshotTotalWeight));
    }

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
        if (clearTotal == 0) {
            _prizeReserve = FHE.add(_prizeReserve, _drawPrize);
            _drawPrize = FHE.asEuint64(0);
            _allowStored(_prizeReserve);
            _allowStored(_drawPrize);
            emit DrawCancelledEmpty(drawId);
            _beginSync();
            return;
        }
        if (clearTotal > MAX_SUPPORTED_TOTAL) revert TotalWeightTooLarge(clearTotal);

        revealedTotalWeight = clearTotal;
        _beginSelection(clearTotal);
    }

    function processSelectionBatch(uint16 requestedBatchSize) external {
        if (state != DrawState.Selecting) revert InvalidDrawState(DrawState.Selecting, state);
        if (requestedBatchSize == 0 || requestedBatchSize > MAX_BATCH_SIZE) revert InvalidBatchSize();

        uint16 start = selectionCursor;
        uint16 end = _boundedEnd(start, requestedBatchSize);
        for (uint16 index = start; index < end; ++index) {
            address participant = _participants[index];
            _cumulativeWeight = FHE.add(_cumulativeWeight, _eligibleWeight[participant]);

            ebool targetInsidePrefix = FHE.lt(_target, _cumulativeWeight);
            ebool firstMatch = FHE.and(FHE.not(_winnerFound), targetInsidePrefix);
            ebool wins = FHE.and(_candidateValid, firstMatch);
            euint64 award = FHE.select(wins, _drawPrize, FHE.asEuint64(0));

            _winnings[participant] = FHE.add(_winnings[participant], award);
            _winnerFound = FHE.or(_winnerFound, wins);
            _allowStored(_cumulativeWeight);
            _allowUserValue(_winnings[participant], participant);
            FHE.allowThis(_winnerFound);
        }

        selectionCursor = end;
        emit SelectionBatchProcessed(drawId, start, end);
        if (end == _participants.length) {
            FHE.makePubliclyDecryptable(_winnerFound);
            state = DrawState.AwaitingResultDecryption;
            emit ResultDecryptionRequested(drawId, FHE.toBytes32(_winnerFound));
        }
    }

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
            emit DrawRetryStarted(drawId, retryCount);
            _beginSelection(revealedTotalWeight);
            return;
        }

        unchecked {
            ++completedDraws;
        }
        emit DrawCompleted(drawId);
        _beginSync();
    }

    /// @notice Resynchronizes next-draw weights with current withdrawable principal.
    function processNextDrawSyncBatch(uint16 requestedBatchSize) external {
        if (state != DrawState.Syncing) revert InvalidDrawState(DrawState.Syncing, state);
        if (requestedBatchSize == 0 || requestedBatchSize > MAX_BATCH_SIZE) revert InvalidBatchSize();

        uint16 start = syncCursor;
        uint16 end = _boundedEnd(start, requestedBatchSize);
        for (uint16 index = start; index < end; ++index) {
            address participant = _participants[index];
            _eligibleWeight[participant] = _principal[participant];
            _nextTotalEligibleWeight = FHE.add(_nextTotalEligibleWeight, _eligibleWeight[participant]);
            _allowStored(_eligibleWeight[participant]);
            _allowStored(_nextTotalEligibleWeight);
        }
        syncCursor = end;
        emit NextDrawSyncProcessed(start, end);

        if (end == _participants.length) {
            _totalEligibleWeight = _nextTotalEligibleWeight;
            _allowStored(_totalEligibleWeight);
            state = DrawState.Open;
            retryCount = 0;
            revealedTotalWeight = 0;
            unchecked {
                ++drawId;
            }
            nextDrawAt = uint64(block.timestamp) + drawInterval;
            emit PoolReopened(drawId, nextDrawAt);
        }
    }

    function encryptedPrincipalOf(address participant) external view returns (euint64) {
        return _principal[participant];
    }

    function encryptedWinningsOf(address participant) external view returns (euint64) {
        return _winnings[participant];
    }

    function encryptedPrizeReserve() external view returns (euint64) {
        return _prizeReserve;
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

    function _registerParticipant(address participant) internal {
        if (_participantIndexPlusOne[participant] != 0) return;
        if (_participants.length >= MAX_PARTICIPANTS) revert ParticipantLimitReached();
        _participants.push(participant);
        _participantIndexPlusOne[participant] = uint16(_participants.length);
        _principal[participant] = FHE.asEuint64(0);
        _eligibleWeight[participant] = FHE.asEuint64(0);
        _winnings[participant] = FHE.asEuint64(0);
        _allowUserValue(_principal[participant], participant);
        _allowStored(_eligibleWeight[participant]);
        _allowUserValue(_winnings[participant], participant);
    }

    function _beginSelection(uint64 clearTotal) internal {
        uint64 upperBound = _nextPowerOfTwo(clearTotal);
        (_target, _candidateValid) = _sampleTarget(upperBound, clearTotal);
        _cumulativeWeight = FHE.asEuint64(0);
        _winnerFound = FHE.asEbool(false);
        selectionCursor = 0;
        state = DrawState.Selecting;
        _allowStored(_target);
        FHE.allowThis(_candidateValid);
        _allowStored(_cumulativeWeight);
        FHE.allowThis(_winnerFound);
        emit SelectionStarted(drawId, clearTotal, upperBound, retryCount);
    }

    function _beginSync() internal {
        _nextTotalEligibleWeight = FHE.asEuint64(0);
        _allowStored(_nextTotalEligibleWeight);
        syncCursor = 0;
        state = DrawState.Syncing;
    }

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

    function _transferAsset(address to, euint64 amount) internal {
        FHE.allowTransient(amount, address(asset));
        asset.confidentialTransfer(to, amount);
    }

    function _isAlreadySynced(address participant) internal view returns (bool) {
        uint16 indexPlusOne = _participantIndexPlusOne[participant];
        return indexPlusOne != 0 && indexPlusOne - 1 < syncCursor;
    }

    function _boundedEnd(uint16 start, uint16 batchSize) internal view returns (uint16) {
        uint256 proposedEnd = uint256(start) + batchSize;
        return proposedEnd < _participants.length ? uint16(proposedEnd) : uint16(_participants.length);
    }

    function _initialized(euint64 value) internal returns (euint64) {
        return FHE.isInitialized(value) ? value : FHE.asEuint64(0);
    }

    function _allowStored(euint64 value) internal {
        FHE.allowThis(value);
    }

    function _allowUserValue(euint64 value, address user) internal {
        FHE.allowThis(value);
        FHE.allow(value, user);
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
