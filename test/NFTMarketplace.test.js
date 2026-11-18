// 测试文件：npm test 运行
// 覆盖：铸造、版税、上架、购买、费用拆分、拉取式支付、取消、权限、暂停、幽灵上架、
//       费率快照、重入攻击等核心场景
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFTMarketplace", function () {
  let nft, market, owner, creator, seller, buyer, other;

  const TOKEN_URI = "ipfs://QmTest123456789";
  const PRICE = ethers.parseEther("1"); // 1 ETH
  const FEE_BPS = 250n; // 2.5%
  const ROYALTY_BPS = 500n; // 5%

  // 0.05 ETH 版税 / 0.025 ETH 平台费 / 0.925 ETH 卖家所得
  const FEE = (PRICE * FEE_BPS) / 10_000n;
  const ROYALTY = (PRICE * ROYALTY_BPS) / 10_000n;
  const PROCEEDS = PRICE - FEE - ROYALTY;

  beforeEach(async function () {
    [owner, creator, seller, buyer, other] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("MyNFT");
    nft = await NFT.deploy();
    await nft.waitForDeployment();

    const Market = await ethers.getContractFactory("NFTMarketplace");
    market = await Market.deploy(await nft.getAddress(), FEE_BPS);
    await market.waitForDeployment();

    // 创作者铸造 #0，再转卖给 seller —— 这样 #0 的版税收款人是 creator，
    // 卖家是 seller，两者分开，才看得出「版税流向创作者」这条逻辑。
    await nft.connect(creator).mint(TOKEN_URI);
    await nft
      .connect(creator)
      .transferFrom(creator.address, seller.address, 0);
  });

  // 辅助函数：seller 授权 + 上架
  async function listToken() {
    await nft.connect(seller).approve(await market.getAddress(), 0);
    await market.connect(seller).list(0, PRICE);
  }

  // ---------- 铸造与版税 ----------

  it("铸造 NFT：owner 正确、tokenURI 正确、总数正确", async function () {
    await nft.connect(other).mint("ipfs://QmSecond");
    expect(await nft.ownerOf(1)).to.equal(other.address);
    expect(await nft.tokenURI(1)).to.equal("ipfs://QmSecond");
    expect(await nft.totalMinted()).to.equal(2n);
  });

  it("铸造时写入 EIP-2981 版税：收款人是铸造者，比例 5%", async function () {
    const [receiver, amount] = await nft.royaltyInfo(0, PRICE);
    expect(receiver).to.equal(creator.address);
    expect(amount).to.equal(ROYALTY);
  });

  it("supportsInterface 同时声明 ERC-721 与 ERC-2981", async function () {
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
    expect(await nft.supportsInterface("0x2a55205a")).to.equal(true); // ERC-2981
  });

  // ---------- 上架 ----------

  it("未 approve 市场时不能上架", async function () {
    await expect(market.connect(seller).list(0, PRICE)).to.be.revertedWith(
      "marketplace not approved"
    );
  });

  it("非持有人不能上架", async function () {
    // 持有人已授权（授权检查会通过），但调用者不是 NFT 持有人 → 必须被拒
    await nft.connect(seller).approve(await market.getAddress(), 0);
    await expect(market.connect(other).list(0, PRICE)).to.be.revertedWith(
      "not token owner"
    );
  });

  it("可以上架并触发 Listed 事件（含费率快照）", async function () {
    await nft.connect(seller).approve(await market.getAddress(), 0);
    await expect(market.connect(seller).list(0, PRICE))
      .to.emit(market, "Listed")
      .withArgs(0, seller.address, PRICE, FEE_BPS);

    const listing = await market.listings(0);
    expect(listing.seller).to.equal(seller.address);
    expect(listing.price).to.equal(PRICE);
    expect(listing.feeBps).to.equal(FEE_BPS);
  });

  it("同一枚 NFT 不能重复上架", async function () {
    await listToken();
    await expect(market.connect(seller).list(0, PRICE)).to.be.revertedWith(
      "already listed"
    );
  });

  // ---------- 购买与费用拆分 ----------

  it("购买后：NFT 转移、费用按「版税→平台费→卖家」拆分", async function () {
    await listToken();

    await expect(market.connect(buyer).buy(0, { value: PRICE }))
      .to.emit(market, "Purchased")
      .withArgs(
        0,
        buyer.address,
        seller.address,
        PRICE,
        FEE,
        ROYALTY,
        creator.address
      );

    expect(await nft.ownerOf(0)).to.equal(buyer.address);
    expect(await market.accumulatedFees()).to.equal(FEE);
    // 卖家只拿到扣掉版税和平台费之后的部分
    expect(await market.pendingReturns(seller.address)).to.equal(PROCEEDS);
    // 版税记在创作者名下
    expect(await market.pendingReturns(creator.address)).to.equal(ROYALTY);
    // 上架记录已删除
    expect((await market.listings(0)).seller).to.equal(ethers.ZeroAddress);
  });

  it("拉取式支付：卖家可以提到货款，且不能重复提取", async function () {
    await listToken();
    await market.connect(buyer).buy(0, { value: PRICE });

    await expect(market.connect(seller).withdrawProceeds()).to.changeEtherBalances(
      [market],
      [-PROCEEDS]
    );
    expect(await market.pendingReturns(seller.address)).to.equal(0n);

    await expect(
      market.connect(seller).withdrawProceeds()
    ).to.be.revertedWith("nothing to withdraw");
  });

  it("拉取式支付：创作者可以提到版税", async function () {
    await listToken();
    await market.connect(buyer).buy(0, { value: PRICE });

    await expect(
      market.connect(creator).withdrawProceeds()
    ).to.changeEtherBalances([market], [-ROYALTY]);
    expect(await market.pendingReturns(creator.address)).to.equal(0n);
  });

  it("卖家不能购买自己的上架", async function () {
    await listToken();
    await expect(
      market.connect(seller).buy(0, { value: PRICE })
    ).to.be.revertedWith("seller cannot buy own listing");
  });

  it("支付金额不等于标价时回滚", async function () {
    await listToken();
    await expect(
      market.connect(buyer).buy(0, { value: ethers.parseEther("0.5") })
    ).to.be.revertedWith("incorrect payment");
  });

  it("幽灵上架：上架后把 NFT 转走，购买会明确失败而不是白扣 gas", async function () {
    await listToken();
    // seller 在上架后把 NFT 转给 other（授权仍在，市场却已无权转移）
    await nft
      .connect(seller)
      .transferFrom(seller.address, other.address, 0);

    await expect(
      market.connect(buyer).buy(0, { value: PRICE })
    ).to.be.revertedWith("seller no longer owns token");
  });

  // ---------- 取消 ----------

  it("卖家可以取消上架", async function () {
    await listToken();
    await expect(market.connect(seller).cancel(0))
      .to.emit(market, "ListingCancelled")
      .withArgs(0, seller.address);
    expect((await market.listings(0)).seller).to.equal(ethers.ZeroAddress);
  });

  it("非上架者不能取消别人的上架", async function () {
    await listToken();
    await expect(market.connect(other).cancel(0)).to.be.revertedWith(
      "not the seller"
    );
  });

  // ---------- 管理员与费率 ----------

  it("费率快照：上架后管理员提高费率，不影响已上架订单", async function () {
    await listToken();
    await market.connect(owner).setPlatformFee(1000n); // 改成 10%

    await expect(market.connect(buyer).buy(0, { value: PRICE }))
      .to.emit(market, "Purchased")
      .withArgs(
        0,
        buyer.address,
        seller.address,
        PRICE,
        FEE, // 仍按上架时的 2.5%
        ROYALTY,
        creator.address
      );
  });

  it("费率上限：1000 bps 允许，1001 bps 回滚", async function () {
    await expect(market.connect(owner).setPlatformFee(1000n)).to.emit(
      market,
      "PlatformFeeUpdated"
    );
    await expect(
      market.connect(owner).setPlatformFee(1001n)
    ).to.be.revertedWith("fee too high");
  });

  it("只有管理员能修改费率", async function () {
    await expect(
      market.connect(buyer).setPlatformFee(100n)
    ).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
  });

  it("只有管理员能提取手续费", async function () {
    await listToken();
    await market.connect(buyer).buy(0, { value: PRICE });

    await expect(
      market.connect(buyer).withdrawFees()
    ).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");

    await expect(market.connect(owner).withdrawFees()).to.emit(
      market,
      "FeesWithdrawn"
    );
    expect(await market.accumulatedFees()).to.equal(0n);
  });

  // ---------- 暂停 ----------

  it("暂停后不能上架和购买，但仍可以取消与提现", async function () {
    await listToken();
    await market.connect(owner).pause();

    await expect(
      market.connect(buyer).buy(0, { value: PRICE })
    ).to.be.revertedWithCustomError(market, "EnforcedPause");

    await expect(
      market.connect(seller).list(0, PRICE)
    ).to.be.revertedWithCustomError(market, "EnforcedPause");

    // 退出通道必须保持通畅
    await expect(market.connect(seller).cancel(0)).to.emit(
      market,
      "ListingCancelled"
    );
  });

  // ---------- 重入攻击 ----------

  it("重入攻击：买家合约在 onERC721Received 里重入 buy() 无法二次成交", async function () {
    await listToken();

    const Attacker = await ethers.getContractFactory("ReentrantBuyer");
    const attacker = await Attacker.deploy(await market.getAddress());
    await attacker.waitForDeployment();

    // 预存 1 ETH 供重入调用使用
    await owner.sendTransaction({
      to: await attacker.getAddress(),
      value: PRICE,
    });

    await attacker.attack(0, PRICE, { value: PRICE });

    // 外层购买成功，NFT 到了攻击合约
    expect(await nft.ownerOf(0)).to.equal(await attacker.getAddress());
    // 但重入的那次调用被挡住了
    expect(await attacker.reentrySucceeded()).to.equal(false);
    // 上架记录已被删除，攻击者没有拿到第二枚
    expect((await market.listings(0)).seller).to.equal(ethers.ZeroAddress);
  });
});
