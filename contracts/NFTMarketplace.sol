// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// 复用 OpenZeppelin 的安全组件（作业加分项）
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
// OpenZeppelin v5 起，ReentrancyGuard 与 Pausable 位于 utils/ 目录（旧版在 security/）
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title NFTMarketplace —— 固定价格 NFT 市场（含 EIP-2981 版税结算）
/// @notice 卖家把 NFT 上架并标价；买家支付 ETH 购买；成交金额按
///         「创作者版税 → 平台手续费 → 卖家所得」的顺序拆分。
/// @dev 安全设计要点：
///      1) 所有 ETH 支出改为**拉取式支付（pull payment）**：合约只记账，
///         收款人自己调用 withdrawProceeds() 提现。这样即使卖家是一个
///         拒收 ETH 的合约，也不会让别人的购买交易永久失败。
///      2) 上架时**快照手续费率**，管理员事后改费率不影响已上架订单。
///      3) 严格遵循 checks-effects-interactions：先删上架记录、记账、发事件，
///         最后才做唯一的一次外部调用（NFT 转移）。
contract NFTMarketplace is Ownable2Step, ReentrancyGuard, Pausable {
    // 一条上架信息
    struct Listing {
        address seller; // 卖家（20 bytes）
        uint96 feeBps;  // 上架时快照的平台费率（12 bytes，与 seller 打包进同一 slot）
        uint256 price;  // 标价（单位 wei）
    }

    // 被交易的 NFT 合约
    IERC721 public immutable nft;

    // 版税信息来源（同一个 NFT 合约，实现了 EIP-2981）
    IERC2981 public immutable royaltySource;

    // 平台手续费（基点，1 bps = 0.01%）。250 = 2.5%
    uint256 public platformFeeBps;

    // 手续费上限 10%，防止管理员乱收费
    uint256 public constant MAX_FEE_BPS = 1000;

    // 已累计但尚未提取的平台手续费
    uint256 public accumulatedFees;

    // tokenId => 上架信息；seller == address(0) 表示未上架
    mapping(uint256 => Listing) public listings;

    // 拉取式支付账本：地址 => 待提取的 ETH（卖家货款 + 创作者版税）
    mapping(address => uint256) public pendingReturns;

    // ---------- 事件 ----------
    event Listed(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price,
        uint96 feeBps
    );
    event Purchased(
        uint256 indexed tokenId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 platformFee,
        uint256 royalty,
        address royaltyReceiver
    );
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event ProceedsWithdrawn(address indexed account, uint256 amount);

    constructor(address _nft, uint256 _feeBps) Ownable(msg.sender) {
        require(_feeBps <= MAX_FEE_BPS, "fee too high");
        nft = IERC721(_nft);
        royaltySource = IERC2981(_nft);
        platformFeeBps = _feeBps;
    }

    // 只有上架者本人能取消
    modifier onlySeller(uint256 tokenId) {
        require(listings[tokenId].seller == msg.sender, "not the seller");
        _;
    }

    // ---------- 卖家操作 ----------

    /// @notice 上架 NFT 并标价（调用前必须先 approve 本市场合约）
    function list(uint256 tokenId, uint256 price) external whenNotPaused {
        require(price > 0, "price must be > 0");
        require(nft.ownerOf(tokenId) == msg.sender, "not token owner");
        require(
            nft.getApproved(tokenId) == address(this) ||
                nft.isApprovedForAll(msg.sender, address(this)),
            "marketplace not approved"
        );
        require(listings[tokenId].seller == address(0), "already listed");

        // 快照当前费率：之后管理员改费率不影响这一笔上架
        listings[tokenId] = Listing({
            seller: msg.sender,
            feeBps: uint96(platformFeeBps),
            price: price
        });
        emit Listed(tokenId, msg.sender, price, uint96(platformFeeBps));
    }

    /// @notice 取消上架（暂停期间也允许撤单，保护用户退出权）
    function cancel(uint256 tokenId) external onlySeller(tokenId) {
        delete listings[tokenId];
        emit ListingCancelled(tokenId, msg.sender);
    }

    // ---------- 买家操作 ----------

    /// @notice 按标价购买 NFT（需要随交易发送正好等于 price 的 ETH）
    function buy(uint256 tokenId) external payable nonReentrant whenNotPaused {
        Listing memory item = listings[tokenId];
        require(item.seller != address(0), "not listed");
        require(item.seller != msg.sender, "seller cannot buy own listing");
        require(msg.value == item.price, "incorrect payment");
        // 防止「幽灵上架」：上架后卖家可能已把 NFT 转走
        require(nft.ownerOf(tokenId) == item.seller, "seller no longer owns token");

        // ---- 金额拆分：版税 → 平台费 → 卖家 ----
        uint256 fee = (item.price * item.feeBps) / 10_000;
        (address royaltyReceiver, uint256 royalty) = royaltySource.royaltyInfo(
            tokenId,
            item.price
        );
        // 防御性上限：任何异常版税配置都不能让卖家倒贴或令交易回滚
        if (royalty > item.price - fee) {
            royalty = item.price - fee;
        }
        uint256 sellerProceeds = item.price - fee - royalty;

        // ---- checks-effects：先改状态、再记账、再发事件 ----
        delete listings[tokenId];
        accumulatedFees += fee;
        if (sellerProceeds > 0) {
            pendingReturns[item.seller] += sellerProceeds;
        }
        if (royalty > 0) {
            pendingReturns[royaltyReceiver] += royalty;
        }

        emit Purchased(
            tokenId,
            msg.sender,
            item.seller,
            item.price,
            fee,
            royalty,
            royaltyReceiver
        );

        // ---- interactions：唯一一次外部调用（NFT 转移，无 ETH 参与）----
        nft.safeTransferFrom(item.seller, msg.sender, tokenId);
    }

    // ---------- 收款人提现（拉取式支付）----------

    /// @notice 卖家提取货款、创作者提取版税，都走这一个入口
    function withdrawProceeds() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        require(amount > 0, "nothing to withdraw");

        pendingReturns[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "withdraw failed");

        emit ProceedsWithdrawn(msg.sender, amount);
    }

    // ---------- 管理员操作（onlyOwner 权限控制）----------

    /// @notice 修改平台手续费率（基点，上限 10%）；只影响之后的新上架
    function setPlatformFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "fee too high");
        uint256 oldFee = platformFeeBps;
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(oldFee, newFeeBps);
    }

    /// @notice 提取累计手续费到管理员地址
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        require(amount > 0, "no fees to withdraw");

        accumulatedFees = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "withdraw failed");

        emit FeesWithdrawn(msg.sender, amount);
    }

    /// @notice 紧急暂停（禁止上架和购买，但允许 cancel 与 withdraw）
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice 恢复
    function unpause() external onlyOwner {
        _unpause();
    }
}
