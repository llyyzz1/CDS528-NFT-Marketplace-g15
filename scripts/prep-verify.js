// 生成 Etherscan 手动验证所需的标准 JSON 输入
// 用法：node scripts/prep-verify.js [MyNFT地址]
// 产出：verify-input.json（项目根目录），并打印构造参数
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const buildDir = path.join(__dirname, "..", "artifacts", "build-info");

if (!fs.existsSync(buildDir)) {
  console.error("找不到 artifacts/build-info，请先运行：npx hardhat compile");
  process.exit(1);
}

const files = fs.readdirSync(buildDir).filter((f) => f.endsWith(".json"));
let found = false;

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(buildDir, f), "utf8"));
  const sources = Object.keys((j.input && j.input.sources) || {});
  const hasMarket = sources.some((s) => s.includes("NFTMarketplace.sol"));

  if (hasMarket) {
    const outPath = path.join(__dirname, "..", "verify-input.json");
    fs.writeFileSync(outPath, JSON.stringify(j.input, null, 2), "utf8");
    console.log("已生成 verify-input.json");
    console.log("  solc long version :", j.solcLongVersion);
    console.log("  optimizer         :", JSON.stringify(j.input.settings.optimizer));
    console.log("  evmVersion        :", j.input.settings.evmVersion || "(default)");
    console.log("  sources           :", sources.length, "files");
    console.log("");
    console.log("Etherscan 验证页面上这样填：");
    console.log("  Compiler Type    : Solidity (Standard-Json-Input)");
    console.log("  Compiler Version :", j.solcLongVersion);
    console.log("  License          : MIT");
    console.log("  Standard Input   : 粘贴 verify-input.json 的全部内容");
    console.log("  Constructor Args : MyNFT 留空；市场合约见下面的十六进制");

    const nftAddr = process.argv[2];
    if (nftAddr && ethers.isAddress(nftAddr)) {
      const args = ethers.AbiCoder.defaultAbiCoder()
        .encode(["address", "uint256"], [nftAddr, 250])
        .replace(/^0x/, "");
      console.log("");
      console.log("NFTMarketplace 的构造参数（粘贴到 Constructor Arguments）：");
      console.log(args);
    } else {
      console.log("");
      console.log("想要市场合约的构造参数，这样运行：");
      console.log("  node scripts/prep-verify.js 0x<你的MyNFT地址>");
    }

    found = true;
    break;
  }
}

if (!found) {
  console.error("在 build-info 里没找到包含 NFTMarketplace.sol 的编译记录");
  process.exit(1);
}
