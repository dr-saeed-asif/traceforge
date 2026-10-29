// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Public commitments only; this contract does not prove off-chain truth.
/// @dev A wallet owner can rotate the separate authorization signer. A revoked
/// historical signer cannot be restored. Deploy a NEW registry; V1 is immutable.
contract VerifiedClaimRegistryV2 {
    address public immutable owner;
    address public immutable revokedSigner;
    address public authorizedSigner;
    uint64 public signerEpoch = 1;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant TYPEHASH = keccak256("ClaimAnchor(bytes32 sessionHash,uint32 claimIndex,bytes32 manifestHash,bytes32 evidenceRoot,uint32 schemaVersion,uint256 nonce,uint64 deadline,uint64 signerEpoch)");
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    struct AnchorRecord { bytes32 sessionHash; uint32 claimIndex; bytes32 manifestHash; bytes32 evidenceRoot; uint32 schemaVersion; uint64 anchoredAt; address anchoredBy; bool verified; }
    mapping(bytes32 => AnchorRecord) public records;
    mapping(bytes32 => bool) public usedNonces;
    event SignerRotated(address indexed previousSigner, address indexed signer, uint64 epoch);
    event VerifiedClaimAnchored(bytes32 indexed recordId, bytes32 indexed sessionHash, uint32 claimIndex, bytes32 manifestHash, bytes32 evidenceRoot, uint32 schemaVersion, uint64 anchoredAt, address indexed anchoredBy);
    error Unauthorized(); error InvalidSigner(); error InvalidAnchor(); error InvalidSignature(); error Expired(); error Replay();

    constructor(address initialSigner, address permanentlyRevokedSigner) {
        if (initialSigner == address(0) || initialSigner == permanentlyRevokedSigner || permanentlyRevokedSigner == address(0)) revert InvalidSigner();
        owner = msg.sender; revokedSigner = permanentlyRevokedSigner; authorizedSigner = initialSigner;
        DOMAIN_SEPARATOR = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("TraceForge Verified Claim Registry"), keccak256("2"), block.chainid, address(this)));
    }
    function rotateSigner(address signer) external {
        if (msg.sender != owner) revert Unauthorized();
        if (signer == address(0) || signer == revokedSigner || signer == authorizedSigner) revert InvalidSigner();
        address previous = authorizedSigner; authorizedSigner = signer; signerEpoch++;
        emit SignerRotated(previous, signer, signerEpoch);
    }
    function anchorVerifiedClaimWithAuthorization(bytes32 sessionHash, uint32 claimIndex, bytes32 manifestHash, bytes32 evidenceRoot, uint32 schemaVersion, uint256 nonce, uint64 deadline, bytes calldata signature) external returns (bytes32 id) {
        if (block.timestamp > deadline) revert Expired();
        if (sessionHash == bytes32(0) || manifestHash == bytes32(0) || evidenceRoot == bytes32(0) || schemaVersion == 0) revert InvalidAnchor();
        bytes32 nonceId = keccak256(abi.encode(signerEpoch, nonce));
        id = keccak256(abi.encode(sessionHash, claimIndex));
        if (usedNonces[nonceId] || records[id].anchoredAt != 0) revert Replay();
        bytes32 body = keccak256(abi.encode(TYPEHASH, sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, nonce, deadline, signerEpoch));
        if (_recover(keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, body)), signature) != authorizedSigner) revert InvalidSignature();
        usedNonces[nonceId] = true;
        records[id] = AnchorRecord(sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, uint64(block.timestamp), msg.sender, true);
        emit VerifiedClaimAnchored(id, sessionHash, claimIndex, manifestHash, evidenceRoot, schemaVersion, uint64(block.timestamp), msg.sender);
    }
    function getAnchor(bytes32 id) external view returns (AnchorRecord memory) { return records[id]; }
    function getRecordId(bytes32 sessionHash, uint32 claimIndex) external pure returns (bytes32) { return keccak256(abi.encode(sessionHash, claimIndex)); }
    function _recover(bytes32 digest, bytes calldata signature) private pure returns(address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset,32)) v := byte(0,calldataload(add(signature.offset,64))) }
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest,v,r,s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
