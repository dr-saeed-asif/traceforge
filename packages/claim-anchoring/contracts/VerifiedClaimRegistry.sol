// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stores immutable commitments to claims already verified by TraceForge.
/// @dev This contract records the deployer's attestation; it cannot independently
///      inspect TraceForge's off-chain evidence or prove that verification was correct.
contract VerifiedClaimRegistry {
    address public immutable owner;

    struct AnchorRecord {
        bytes32 sessionHash;
        uint32 claimIndex;
        bytes32 manifestHash;
        bytes32 evidenceRoot;
        uint32 schemaVersion;
        uint64 anchoredAt;
        address anchoredBy;
        bool verified;
    }

    mapping(bytes32 => AnchorRecord) private records;

    event VerifiedClaimAnchored(
        bytes32 indexed recordId,
        bytes32 indexed sessionHash,
        uint32 claimIndex,
        bytes32 manifestHash,
        bytes32 evidenceRoot,
        uint32 schemaVersion,
        uint64 anchoredAt,
        address indexed anchoredBy
    );

    error NotOwner();
    error InvalidAnchor();
    error AlreadyAnchored(bytes32 recordId);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Anchors one VERIFIED TraceForge claim. Only the deployer can submit.
    function anchorVerifiedClaim(
        bytes32 sessionHash,
        uint32 claimIndex,
        bytes32 manifestHash,
        bytes32 evidenceRoot,
        uint32 schemaVersion
    ) external onlyOwner returns (bytes32 recordId) {
        if (
            sessionHash == bytes32(0) || manifestHash == bytes32(0)
                || evidenceRoot == bytes32(0) || schemaVersion == 0
        ) revert InvalidAnchor();

        recordId = keccak256(abi.encode(sessionHash, claimIndex));
        if (records[recordId].anchoredAt != 0) revert AlreadyAnchored(recordId);

        uint64 anchoredAt = uint64(block.timestamp);
        records[recordId] = AnchorRecord({
            sessionHash: sessionHash,
            claimIndex: claimIndex,
            manifestHash: manifestHash,
            evidenceRoot: evidenceRoot,
            schemaVersion: schemaVersion,
            anchoredAt: anchoredAt,
            anchoredBy: msg.sender,
            verified: true
        });

        emit VerifiedClaimAnchored(
            recordId,
            sessionHash,
            claimIndex,
            manifestHash,
            evidenceRoot,
            schemaVersion,
            anchoredAt,
            msg.sender
        );
    }

    function getAnchor(bytes32 recordId) external view returns (AnchorRecord memory) {
        return records[recordId];
    }

    function getRecordId(bytes32 sessionHash, uint32 claimIndex) external pure returns (bytes32) {
        return keccak256(abi.encode(sessionHash, claimIndex));
    }
}
