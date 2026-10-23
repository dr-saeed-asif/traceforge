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
    error InvalidSignature();
    error SignatureExpired();
    error NonceAlreadyUsed();

    mapping(bytes32 => bool) public usedNonces;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CLAIM_ANCHOR_TYPEHASH = keccak256("ClaimAnchor(bytes32 sessionHash,uint32 claimIndex,bytes32 manifestHash,bytes32 evidenceRoot,uint32 schemaVersion,uint256 nonce,uint64 deadline)");
    bytes32 private immutable domainSeparator;

    constructor() {
        owner = msg.sender;
        domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("TraceForge Verified Claim Registry")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
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
        return _storeAnchor(sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, msg.sender);
    }

    /// @notice Allows any user to submit an owner-signed TraceForge attestation.
    function anchorVerifiedClaimWithAuthorization(
        bytes32 sessionHash,
        uint32 claimIndex,
        bytes32 manifestHash,
        bytes32 evidenceRoot,
        uint32 schemaVersion,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external returns (bytes32 recordId) {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 nonceKey = keccak256(abi.encode(nonce));
        if (usedNonces[nonceKey]) revert NonceAlreadyUsed();
        bytes32 structHash = keccak256(abi.encode(CLAIM_ANCHOR_TYPEHASH, sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        if (_recoverSigner(digest, signature) != owner) revert InvalidSignature();
        usedNonces[nonceKey] = true;
        return _storeAnchor(sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, msg.sender);
    }

    function _storeAnchor(bytes32 sessionHash, uint32 claimIndex, bytes32 manifestHash, bytes32 evidenceRoot, uint32 schemaVersion, address submitter) private returns (bytes32 recordId) {
        if (sessionHash == bytes32(0) || manifestHash == bytes32(0) || evidenceRoot == bytes32(0) || schemaVersion == 0) revert InvalidAnchor();
        recordId = keccak256(abi.encode(sessionHash, claimIndex));
        if (records[recordId].anchoredAt != 0) revert AlreadyAnchored(recordId);
        uint64 anchoredAt = uint64(block.timestamp);
        records[recordId] = AnchorRecord(sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, anchoredAt, submitter, true);
        emit VerifiedClaimAnchored(recordId, sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, anchoredAt, submitter);
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function getAnchor(bytes32 recordId) external view returns (AnchorRecord memory) {
        return records[recordId];
    }

    function getRecordId(bytes32 sessionHash, uint32 claimIndex) external pure returns (bytes32) {
        return keccak256(abi.encode(sessionHash, claimIndex));
    }
}
