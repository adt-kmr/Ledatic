// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProofRegistry
 * @notice Anchors SHA-256 hashes of Hyperledger Fabric transaction batches
 *         onto Sepolia for public verifiability. The existing Fabric chaincodes
 *         stay as-is; this contract provides an immutable audit trail.
 */
contract ProofRegistry {
    struct Proof {
        bytes32 batchHash;
        uint256 txCount;
        uint256 timestamp;
        string metadata;
    }

    Proof[] public proofs;
    mapping(bytes32 => bool) public proofExists;

    event ProofAnchored(
        uint256 indexed index,
        bytes32 indexed batchHash,
        uint256 txCount,
        uint256 timestamp
    );

    /**
     * @notice Anchor a batch of Fabric transaction hashes.
     * @param batchHash keccak256 of concatenated tx hashes from the batch
     * @param txCount  number of Fabric transactions in this batch
     * @param metadata human-readable label (e.g. "batch-3", "citadel-channel")
     */
    function anchorProof(
        bytes32 batchHash,
        uint256 txCount,
        string calldata metadata
    ) external returns (uint256 index) {
        require(!proofExists[batchHash], "Proof already anchored");
        require(txCount > 0, "Empty batch");

        index = proofs.length;
        proofs.push(Proof({
            batchHash: batchHash,
            txCount: txCount,
            timestamp: block.timestamp,
            metadata: metadata
        }));
        proofExists[batchHash] = true;

        emit ProofAnchored(index, batchHash, txCount, block.timestamp);
    }

    function getProof(uint256 index) external view returns (Proof memory) {
        require(index < proofs.length, "Index out of bounds");
        return proofs[index];
    }

    function verifyProof(uint256 index, bytes32 batchHash) external view returns (bool) {
        require(index < proofs.length, "Index out of bounds");
        return proofs[index].batchHash == batchHash;
    }

    function proofCount() external view returns (uint256) {
        return proofs.length;
    }
}
