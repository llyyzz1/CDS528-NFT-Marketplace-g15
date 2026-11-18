// 部署脚本：npm run deploy:local（本机） 或 npm run deploy（Sepolia 测试网）
// 部署完成后会把地址、交易哈希、区块号写进 deployments/<network>.json
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("正在用账户部署:", deployer.address);

  // 1. 部署 NFT 合约
  const NFT = await ethers.getContractFactory("MyNFT");
  const nft = await NFT.deploy();
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  const nftTx = nft.deploymentTransaction();
  const nftReceipt = await nftTx.wait();
  console.log("MyNFT 已部署到:", nftAddress);

  // 2. 部署市场合约，平台手续费 2.5%（250 bps）
  const FEE_BPS = 250n;
  const Market = await ethers.getContractFactory("NFTMarketplace");
  const market = await Market.deploy(nftAddress, FEE_BPS);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  const marketTx = market.deploymentTransaction();
  const marketReceipt = await marketTx.wait();
  console.log("NFTMarketplace 已部署到:", marketAddress);
  console.log("平台手续费(bps):", FEE_BPS.toString(), "(= 2.5%)");

  // 3. 写出部署记录，供 README 与报告引用
  const record = {
    network,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString().slice(0, 10),
    deployer: deployer.address,
    compiler: {
      version: "0.8.28+commit.7893614a",
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
    contracts: {
      MyNFT: {
        address: nftAddress,
        txHash: nftTx.hash,
        blockNumber: nftReceipt.blockNumber,
        constructorArgs: [],
      },
      NFTMarketplace: {
        address: marketAddress,
        txHash: marketTx.hash,
        blockNumber: marketReceipt.blockNumber,
        constructorArgs: [nftAddress, Number(FEE_BPS)],
      },
    },
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log("部署记录已写入:", path.relative(path.join(__dirname, ".."), file));

  console.log("\n===== 把下面两个地址记进 README 和报告 =====");
  console.log("MyNFT          :", nftAddress);
  console.log("NFTMarketplace :", marketAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
