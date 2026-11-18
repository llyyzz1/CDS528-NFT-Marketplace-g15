// gas 实测脚本：npx hardhat run scripts/gasreport.js
// 输出一张 Markdown 表，可直接贴进报告 R3 的 gas 小节
const { ethers } = require("hardhat");

const GWEI = 20n; // 假设 20 gwei 作为「现实中的典型 gas price」用于估算

function eth(gas) {
  // gas * gwei -> ETH，保留 6 位小数
  const wei = BigInt(gas) * GWEI * 10n ** 9n;
  const s = ethers.formatEther(wei);
  return Number(s).toFixed(6);
}

async function gasOf(promise) {
  const tx = await promise;
  const receipt = await tx.wait();
  return receipt.gasUsed;
}

async function main() {
  const [owner, creator, seller, buyer] = await ethers.getSigners();

  // ---- 部署 ----
  const NFT = await ethers.getContractFactory("MyNFT");
  const nft = await NFT.deploy();
  const nftDeploy = await nft.deploymentTransaction().wait();
  const nftAddress = await nft.getAddress();

  const Market = await ethers.getContractFactory("NFTMarketplace");
  const market = await Market.deploy(nftAddress, 250n);
  const marketDeploy = await market.deploymentTransaction().wait();
  const marketAddress = await market.getAddress();

  const rows = [];
  rows.push(["部署 `MyNFT`", nftDeploy.gasUsed.toString()]);
  rows.push(["部署 `NFTMarketplace`", marketDeploy.gasUsed.toString()]);

  // ---- 用户流程 ----
  rows.push(["`mint(uri)`", (await gasOf(nft.connect(creator).mint("ipfs://QmGasTest"))).toString()]);
  await nft.connect(creator).transferFrom(creator.address, seller.address, 0);
  rows.push(["`approve(market, tokenId)`", (await gasOf(nft.connect(seller).approve(marketAddress, 0))).toString()]);
  rows.push(["`list(tokenId, price)`", (await gasOf(market.connect(seller).list(0, ethers.parseEther("1")))).toString()]);
  rows.push(["`buy(tokenId)`", (await gasOf(market.connect(buyer).buy(0, { value: ethers.parseEther("1") }))).toString()]);
  rows.push(["`withdrawProceeds()`（卖家）", (await gasOf(market.connect(seller).withdrawProceeds())).toString()]);
  rows.push(["`withdrawProceeds()`（创作者版税）", (await gasOf(market.connect(creator).withdrawProceeds())).toString()]);
  rows.push(["`withdrawFees()`（管理员）", (await gasOf(market.connect(owner).withdrawFees())).toString()]);
  rows.push(["`setPlatformFee(bps)`", (await gasOf(market.connect(owner).setPlatformFee(300n))).toString()]);

  // cancel 需要另造一枚
  await nft.connect(creator).mint("ipfs://QmGasTest2");
  await nft.connect(creator).approve(marketAddress, 1);
  await market.connect(creator).list(1, ethers.parseEther("1"));
  rows.push(["`cancel(tokenId)`", (await gasOf(market.connect(creator).cancel(1))).toString()]);

  // ---- 输出 ----
  console.log("\n| 操作 | gas used | ≈ 费用 @20 gwei (ETH) |");
  console.log("|---|---:|---:|");
  for (const [op, gas] of rows) {
    console.log(`| ${op} | ${Number(gas).toLocaleString("en-US")} | ${eth(gas)} |`);
  }
  console.log(
    "\n> gas price 按 20 gwei 估算；Sepolia 的实际 gas price 通常低于此值。"
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
