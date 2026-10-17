import { expect } from "chai";
import { ethers } from "hardhat";

describe("ProofRegistry", function () {
  let registry: any;
  let owner: any;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const ProofRegistry = await ethers.getContractFactory("ProofRegistry");
    registry = await ProofRegistry.deploy();
    await registry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should start with zero proofs", async function () {
      expect(await registry.proofCount()).to.equal(0);
    });
  });

  describe("anchorProof", function () {
    it("should anchor a proof and emit event", async function () {
      const batchHash = ethers.keccak256(ethers.toUtf8Bytes("batch-0"));
      const tx = await registry.anchorProof(batchHash, 5, "test-batch");

      await expect(tx)
        .to.emit(registry, "ProofAnchored")
        .withArgs(0, batchHash, 5, await getBlockTimestamp(tx));

      expect(await registry.proofCount()).to.equal(1);
    });

    it("should reject empty batch (txCount=0)", async function () {
      const batchHash = ethers.keccak256(ethers.toUtf8Bytes("empty"));
      await expect(
        registry.anchorProof(batchHash, 0, "empty-batch")
      ).to.be.revertedWith("Empty batch");
    });

    it("should reject duplicate proof", async function () {
      const batchHash = ethers.keccak256(ethers.toUtf8Bytes("batch-0"));
      await registry.anchorProof(batchHash, 5, "test-batch");
      await expect(
        registry.anchorProof(batchHash, 5, "test-batch")
      ).to.be.revertedWith("Proof already anchored");
    });

    it("should anchor multiple distinct proofs", async function () {
      for (let i = 0; i < 3; i++) {
        const batchHash = ethers.keccak256(ethers.toUtf8Bytes(`batch-${i}`));
        await registry.anchorProof(batchHash, i + 1, `batch-${i}`);
      }
      expect(await registry.proofCount()).to.equal(3);
    });
  });

  describe("getProof", function () {
    it("should return correct proof data", async function () {
      const batchHash = ethers.keccak256(ethers.toUtf8Bytes("batch-0"));
      const tx = await registry.anchorProof(batchHash, 5, "test-batch");
      const timestamp = await getBlockTimestamp(tx);

      const proof = await registry.getProof(0);
      expect(proof.batchHash).to.equal(batchHash);
      expect(proof.txCount).to.equal(5);
      expect(proof.timestamp).to.equal(timestamp);
      expect(proof.metadata).to.equal("test-batch");
    });

    it("should revert for out-of-bounds index", async function () {
      await expect(registry.getProof(0)).to.be.revertedWith(
        "Index out of bounds"
      );
    });
  });

  describe("verifyProof", function () {
    it("should return true for matching hash", async function () {
      const batchHash = ethers.keccak256(ethers.toUtf8Bytes("batch-0"));
      await registry.anchorProof(batchHash, 5, "test-batch");
      expect(await registry.verifyProof(0, batchHash)).to.be.true;
    });

    it("should return false for mismatching hash", async function () {
      const batchHash = ethers.keccak256(ethers.toUtf8Bytes("batch-0"));
      await registry.anchorProof(batchHash, 5, "test-batch");
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
      expect(await registry.verifyProof(0, wrongHash)).to.be.false;
    });
  });
});

async function getBlockTimestamp(tx: any): Promise<bigint> {
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return block!.timestamp;
}
