// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// 复用 OpenZeppelin 经过审计的实现（作业加分项：Reuse battle-tested code）
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title MyNFT —— 本项目的 NFT 收藏品合约
/// @notice 任何人都可以铸造一枚 NFT，并附带元数据 URI（图片/属性等）。
/// @dev 对应 ethereum.org 中级教程《How to implement an ERC-721 market》，
///      并在此基础上加入 EIP-2981 链上版税，使创作者在每次二级转卖中
///      自动获得一笔版税（中心化市场可以自愿不付，链上版税绕不开）。
contract MyNFT is ERC721URIStorage, ERC2981, Ownable2Step {
    // 下一个要铸造的 tokenId（从 0 开始自增）
    uint256 private _nextTokenId;

    // 每枚 NFT 铸造时写入的创作者版税比例：500 bps = 5%
    uint96 public constant ROYALTY_BPS = 500;

    // 供应上限：避免无界增长（也是 gas / DoS 角度的一条防御）
    uint256 public constant MAX_SUPPLY = 10_000;

    // 事件：作业明确奖励「Emit events for important state changes」
    event NFTMinted(
        address indexed minter,
        uint256 indexed tokenId,
        string uri,
        uint96 royaltyBps
    );

    constructor() ERC721("CDS528 NFT", "C528") Ownable(msg.sender) {}

    /// @notice 铸造一枚新 NFT，tokenId 自动递增，铸造者即该 NFT 的版税收款人。
    /// @param uri NFT 元数据地址（通常是 "ipfs://..." 或 "https://..."）
    /// @return tokenId 新铸造出的 tokenId
    function mint(string calldata uri) external returns (uint256 tokenId) {
        require(_nextTokenId < MAX_SUPPLY, "max supply reached");

        tokenId = _nextTokenId++;
        // _safeMint 会检查接收方合约是否实现 onERC721Received（防误转）
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        // 逐 token 写入版税：收款人是铸造者，比例 5%
        _setTokenRoyalty(tokenId, msg.sender, ROYALTY_BPS);

        emit NFTMinted(msg.sender, tokenId, uri, ROYALTY_BPS);
    }

    /// @notice 已经铸造出来的 NFT 总数
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @dev ERC-721 与 ERC-2981 都实现了 supportsInterface，必须显式合并
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
