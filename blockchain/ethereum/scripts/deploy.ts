import { ethers } from "hardhat";

async function main() {
  const ProofRegistry = await ethers.getContractFactory("ProofRegistry");
  const registry = await ProofRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log(`ProofRegistry deployed to: ${address}`);
  console.log(`Network: ${(await ethers.provider.getNetwork()).name}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
