// 链上状态检查脚本
// 用法：npx hardhat run scripts/checkstate.js --network sepolia
// 作用：一条命令打印两个合约的关键状态，演示前 / 报告截图前跑一次确认一切正常
const { ethers } = require("hardhat");

// 默认读取本次 v2 部署的地址，也可以用环境变量覆盖
const MYNFT_ADDRESS =
  process.env.MYNFT_ADDRESS || "0x5C919c5e8f236EC1913D76ec7A5c6092eA32B8b7";
const MARKET_ADDRESS =
  process.env.MARKET_ADDRESS || "0x7097ebB3eB50A4b4a79346C059895C299f59a4C7";

const WATCH = [
  ["A  部署者 / 管理员 / 创作者", "0x21652e04deaF28840d686fF0394444B04deD35e2"],
  ["B  卖家", "0x6A8DeCA0b27Bf7C05a8f3D0452CACc1497010E78"],
  ["C  买家", "0x82f58da1b2a893dc1253e5668545e3F81EF6E3fc"],
];

function eth(v) {
  return ethers.formatEther(v);
}

async function main() {
  const provider = ethers.provider;
  const net = await provider.getNetwork();

  const nft = await ethers.getContractAt("MyNFT", MYNFT_ADDRESS);
  const market = await ethers.getContractAt("NFTMarketplace", MARKET_ADDRESS);

  console.log("=".repeat(64));
  console.log("CDS528 NFT Marketplace - on-chain state");
  console.log("=".repeat(64));
  console.log(`network        : ${net.name} (chainId ${net.chainId})`);
  console.log(`block          : ${await provider.getBlockNumber()}`);
  console.log(`MyNFT          : ${MYNFT_ADDRESS}`);
  console.log(`NFTMarketplace : ${MARKET_ADDRESS}`);

  // ---- 合约配置
  const owner = await market.owner();
  const feeBps = await market.platformFeeBps();
  const paused = await market.paused();
  console.log("\n-- configuration --");
  console.log(`owner          : ${owner}`);
  console.log(`platformFeeBps : ${feeBps} (= ${Number(feeBps) / 100}%)`);
  console.log(`paused         : ${paused}`);

  // ---- 代币
  const total = await nft.totalMinted();
  console.log("\n-- tokens --");
  console.log(`totalMinted    : ${total}`);
  for (let i = 0; i < Number(total); i++) {
    const holder = await nft.ownerOf(i);
    const [receiver, amount] = await nft.royaltyInfo(
      i,
      ethers.parseEther("1")
    );
    const listing = await market.listings(i);
    const onSale =
      listing.seller === ethers.ZeroAddress
        ? "not listed"
        : `listed by ${listing.seller} @ ${eth(listing.price)} ETH (fee ${listing.feeBps} bps)`;
    console.log(`  #${i}  owner=${holder}`);
    console.log(`       royalty=${eth(amount)} ETH/1ETH -> ${receiver}`);
    console.log(`       ${onSale}`);
  }

  // ---- 资金状态
  console.log("\n-- funds --");
  console.log(`accumulatedFees : ${eth(await market.accumulatedFees())} ETH`);
  for (const [label, addr] of WATCH) {
    const pending = await market.pendingReturns(addr);
    const bal = await provider.getBalance(addr);
    console.log(`  ${label}`);
    console.log(`    address       : ${addr}`);
    console.log(`    pendingReturns: ${eth(pending)} ETH`);
    console.log(`    wallet balance: ${eth(bal)} ETH`);
  }

  // ---- 一致性检查
  console.log("\n-- consistency --");
  const accFees = await market.accumulatedFees();
  let pendingTotal = 0n;
  for (const [, addr] of WATCH) {
    pendingTotal += await market.pendingReturns(addr);
  }
  const leftover = accFees + pendingTotal;
  console.log(
    leftover === 0n
      ? "OK: no funds left inside the contract (all balances withdrawn)"
      : `WARNING: ${eth(leftover)} ETH still held by the contract`
  );
  console.log("=".repeat(64));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
