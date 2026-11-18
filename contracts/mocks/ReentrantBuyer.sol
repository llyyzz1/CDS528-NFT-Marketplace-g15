// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "../NFTMarketplace.sol";

/// @title ReentrantBuyer —— 仅用于测试的重入攻击合约
/// @notice 在 onERC721Received 回调里尝试再次调用 market.buy()。
///         如果 buy() 的防护失效，攻击者就能用一笔钱买走两枚 NFT。
/// @dev 这个合约不会被部署到测试网，只存在于仓库中作为 R4 的安全证据。
contract ReentrantBuyer is IERC721Receiver {
    NFTMarketplace public immutable market;

    uint256 public tokenId;
    uint256 public lastPrice;
    bool public reentrySucceeded;

    constructor(address _market) {
        market = NFTMarketplace(payable(_market));
    }

    receive() external payable {}

    function attack(uint256 _tokenId, uint256 price) external payable {
        tokenId = _tokenId;
        lastPrice = price;
        market.buy{value: price}(_tokenId);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        // 在接收 NFT 的回调里重入 buy()：如果状态没有先更新，这次调用就会成功
        (bool ok, ) = address(market).call{value: lastPrice}(
            abi.encodeCall(NFTMarketplace.buy, (tokenId))
        );
        reentrySucceeded = ok;
        return this.onERC721Received.selector;
    }
}
