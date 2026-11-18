# CDS528 NFT Marketplace v2 — ERC-721 + EIP-2981



A fixed-price, non-custodial NFT marketplace built with **Solidity 0.8.28**, **Hardhat**, and **OpenZeppelin Contracts 5.x**, deployed and source-verified on **Ethereum Sepolia**.

The project follows the ethereum.org intermediate tutorial *How to implement an ERC-721 market* and adds four changes: **EIP-2981 on-chain royalties**, **fee snapshot at listing**, **pull-based ETH payments**, and a **ghost-listing guard**.

## 1. Deployed contracts

| Contract         | Sepolia address                                                                                                                      | Verification |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `MyNFT` (C528)   | [`0x5C919c5e8f236EC1913D76ec7A5c6092eA32B8b7`](https://sepolia.etherscan.io/address/0x5C919c5e8f236EC1913D76ec7A5c6092eA32B8b7#code) | Exact Match  |
| `NFTMarketplace` | [`0x7097ebB3eB50A4b4a79346C059895C299f59a4C7`](https://sepolia.etherscan.io/address/0x7097ebB3eB50A4b4a79346C059895C299f59a4C7#code) | Exact Match  |

- Network: Sepolia, chainId `11155111`
- Platform fee: 250 bps (2.5%), hard cap 1,000 bps (10%)
- Creator royalty: 500 bps (5%)
- Compiler: 0.8.28+commit.7893614a, `evmVersion = cancun`, optimizer on, `runs = 200`
- Tests: 21 passing
- Deployment record: [`deployments/sepolia.json`](deployments/sepolia.json), written by `npm run deploy` and committed after a successful deployment

## 2. What it does

- **Mint** — anyone can mint an NFT with a metadata URI. The minter becomes that token's EIP-2981 royalty receiver (5%).
- **List** — the owner approves the marketplace and sets a price. The current platform fee is snapshotted into the listing.
- **Buy** — the buyer pays exactly the listed price. The price is split three ways: creator royalty, platform fee, seller proceeds.
- **Withdraw** — sellers and creators call `withdrawProceeds()`; the owner calls `withdrawFees()`.

Settlement is atomic and non-custodial. The marketplace never holds the NFT and never transfers ETH during `buy()`, so a seller contract that rejects ETH cannot block a sale.

## 3. Repository layout

```
contracts/
├── MyNFT.sol                  ERC-721 + ERC-2981 + Ownable2Step
├── NFTMarketplace.sol         listings, fee snapshot, three-way split, pull-payment ledger
└── mocks/ReentrantBuyer.sol   test-only attacker, never deployed
scripts/
├── deploy.js                  deploy both contracts and write deployments/<network>.json
├── checkstate.js              read-only live-state inspection
└── gasreport.js               reproduce the gas table
deployments/sepolia.json       v2 deployment record
test/NFTMarketplace.test.js   21 tests
verify/standard-input.json    Etherscan Standard-Json-Input
verify/constructor-args.txt  Market constructor arguments
```

The market depends only on `IERC721` and `IERC2981`, not on the NFT implementation. Trust-critical state and value transfers are on-chain; metadata, UI and event indexing are off-chain.

| Component        | Responsibility                                                 |
| ---------------- | -------------------------------------------------------------- |
| `MyNFT`          | minting, token URI, 5% per-token royalty, 10,000 supply cap    |
| `NFTMarketplace` | listing, fee snapshot, price split, pull-payment ledger, pause |

## 4. Getting started

Prerequisites: Node.js 18+, npm and Git.

```bash
git clone https://github.com/llyyzz1/Marketplace-group.git
cd Marketplace-group
npm install
npm run compile
npm test
```

`npm run compile` compiles 29 Solidity files. `npm test` runs 21 tests.

For a local rehearsal, run `npx hardhat node` in one terminal and `npm run deploy:local` in another. The deploy script writes `deployments/localhost.json`.

The reference deployment can be inspected without sending a transaction:

```bash
npm run check
```

The optimizer-on gas table can be reproduced locally:

```bash
npm run gas
```

## 5. Deploy to Sepolia

Create the environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in the three values:

```ini
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PRIVATE_KEY=your_test_wallet_private_key_without_0x
ETHERSCAN_API_KEY=your_etherscan_api_key
```

Deploy both contracts:

```bash
npm run deploy
```

The script prints the two addresses and transaction hashes, then writes `deployments/sepolia.json`. This is the only deployment entry point; no manual Remix steps are required.

## 6. Verify on Etherscan

Both contracts are verified with Exact Match.

```bash
npx hardhat verify --network sepolia 0x5C919c5e8f236EC1913D76ec7A5c6092eA32B8b7

npx hardhat verify --network sepolia 0x7097ebB3eB50A4b4a79346C059895C299f59a4C7 \
  0x5C919c5e8f236EC1913D76ec7A5c6092eA32B8b7 250
```

For Etherscan Standard-Json-Input verification, use compiler v0.8.28+commit.7893614a, licence MIT, and upload [`verify/standard-input.json`](verify/standard-input.json). For the market, add the constructor arguments from [`verify/constructor-args.txt`](verify/constructor-args.txt).

Verification links:

- MyNFT: <https://sepolia.etherscan.io/address/0x5C919c5e8f236EC1913D76ec7A5c6092eA32B8b7#code>
- Market: <https://sepolia.etherscan.io/address/0x7097ebB3eB50A4b4a79346C059895C299f59a4C7#code>

## 7. Demo

The demonstration uses three accounts. After every MetaMask account switch, refresh Etherscan and click **Connect to Web3** again.

| #   | Contract | Account    | Call                              | Expected result                                            |
| --- | -------- | ---------- | --------------------------------- | ---------------------------------------------------------- |
| 1   | MyNFT    | A, creator | `mint("ipfs://QmTest123456789")`  | New token owned by A; A is royalty receiver                |
| 2   | MyNFT    | A          | `transferFrom(A, B, tokenId)`     | Owner is B; royalty receiver stays A                       |
| 3   | MyNFT    | B          | `approve(market, tokenId)`        | Market approved                                            |
| 4   | Market   | B          | `list(tokenId, 1000000000000000)` | `Listed` with `feeBps = 250`                               |
| 5   | Market   | C, buyer   | `buy(tokenId)` with 0.001 ETH     | NFT moves to C; balances are credited and no ETH is pushed |
| 6   | Market   | B          | `withdrawProceeds()`              | B receives 0.000925 ETH                                    |
| 7   | Market   | A          | `withdrawProceeds()`              | A receives 0.00005 ETH royalty                             |
| 8   | Market   | A          | `withdrawFees()`                  | A receives 0.000025 ETH platform fee                       |

After all withdrawals:

```
0.001 ETH = 0.000025 platform + 0.00005 royalty + 0.000925 seller
accumulatedFees = 0
pendingReturns(A) = 0
pendingReturns(B) = 0
```

`list` takes the price in wei. Etherscan labels the `buy` amount as `payableAmount (ether)`. At the time of writing, the reference deployment has `totalMinted = 2`, with `#0` held by C and `#1` held by A.

## 8. Tests and gas

`npm test` runs 21 tests covering minting, royalties, interfaces, listing rules, the three-way split, wrong payment, self-purchase, ghost listings, cancellation, fee snapshots, withdrawals, owner-only administration, pause exit rights, reentrancy and second-sale royalties. Nine of the 21 cases assert a specific revert reason (`revertedWith` / `revertedWithCustomError`), matching the R4 count in the group report.

Gas measured with `npm run gas`, optimizer on and `runs = 200`:

| Operation               | Gas       |
| ----------------------- | ---------:|
| Deploy `MyNFT`          | 1,461,783 |
| Deploy `NFTMarketplace` | 1,247,184 |
| `mint(uri)`             | 140,577   |
| `list(tokenId, 1 ETH)`  | 81,765    |
| `buy(tokenId)`          | 138,687   |
| `withdrawProceeds()`    | 32,528    |
| `withdrawFees()`        | 34,456    |

The table above is the optimizer-on column. The optimizer-off comparison and the `cancel` row in report Table 3.4 were recorded separately, so `npm run gas` reproduces this user-facing subset rather than every row of the report table.

## 9. Security and operations

| Concern                        | Mitigation                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Reentrancy                     | Checks-effects-interactions in `buy()` and withdrawals, plus `ReentrancyGuard`; the only external call in `buy()` is `safeTransferFrom` |
| Push-payment denial of service | All ETH outflows are pull payments through `pendingReturns`                                                                             |
| Ghost listing                  | `buy()` re-checks `ownerOf` before any state change                                                                                     |
| Fee abuse                      | `MAX_FEE_BPS = 1000`; the fee is snapshotted per listing                                                                                |
| Privilege misuse               | `onlyOwner` and `Ownable2Step`                                                                                                          |
| Integer overflow and supply    | Solidity 0.8.x checked arithmetic; `MAX_SUPPLY = 10000`                                                                                 |

`pause()` blocks `list` and `buy` but keeps `cancel()` and withdrawals open, so users can exit a listing and withdraw owed funds. The contracts are intentionally immutable: no proxy administrator can replace market logic, and any future change requires a new deployment and a new verification.

## 10. References and licensing

Project code and OpenZeppelin Contracts v5 are MIT licensed; Hardhat is MIT licensed. Solidity is GPL-3.0 and is used as a build tool.

- Entriken, W., Shirley, D., Evans, J., & Sachs, N. (2018). *EIP-721: Non-fungible token standard*. https://eips.ethereum.org/EIPS/eip-721
- Ethereum Foundation. (n.d.). *How to implement an ERC-721 market*. https://ethereum.org/developers/tutorials/how-to-implement-an-erc721-market/
- Hardhat. (2026). *Hardhat documentation*. https://hardhat.org/docs
- OpenZeppelin. (2026). *OpenZeppelin Contracts (Version 5)* [Computer software]. https://github.com/OpenZeppelin/openzeppelin-contracts
- Solidity. (2026). *Solidity documentation* (Version 0.8.28). https://docs.soliditylang.org
- Zachariades, Z., Buzynski, J., & Youssef, A. (2021). *EIP-2981: NFT royalty standard*. https://eips.ethereum.org/EIPS/eip-2981

## 11. Related documents

The full API and event tables are in Section 3 of the group report; the threat model and the 21-case test matrix are in Section 4. The address/link sheet and deployment manual are submitted with the report, and this README keeps the repository-facing subset.
