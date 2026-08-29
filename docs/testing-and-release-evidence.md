# Testing and release evidence

## Automated coverage

The Solidity suite contains 27 passing tests covering encrypted deposits and withdrawals, wallet-scoped input-proof rejection, forged public-decryption proof rejection, principal preservation, prize accounting, weighted boundaries, invalid-sample retry, empty-pool cancellation, permissionless lifecycle calls, batching, withdrawals during draw states, ACL behavior, registry validation, participant limits, faucet cooldowns, relayer authorization and HCU regression budgets.

Run it with:

```bash
npm --prefix contracts test
```

To print the HCU measurements while running the dedicated regression tests:

```bash
npm --prefix contracts run test:hcu
```

The HCU tests use the pinned local FHEVM mock coprocessor to calculate `globalHCU` and `maxHCUDepth` from each receipt's FHE operation graph. They assert exact values rather than merely checking that a value was produced, so an algorithm or dependency change must be deliberately reviewed before its new budget is accepted.

| Tested confidential path | Total HCU | Maximum depth |
|---|---:|---:|
| Production random sampler, 8 candidates | 1,968,144 | 607,000 |
| Maximum selection batch, 8 participants | 4,792,080 | 1,709,032 |
| Pool deposit | 1,435,192 | 732,032 |
| Pool prize funding | 748,032 | 369,000 |
| Deterministic two-participant selection batch | 1,198,068 | 737,000 |
| Next-draw synchronization | 324,000 | 324,000 |
| Prize claim | 586,064 | 369,000 |
| Principal withdrawal | 1,273,032 | 570,000 |

These local budgets answer a different question from EVM gas: gas measures host-chain execution, total HCU sums homomorphic operation cost, and maximum HCU depth measures the longest dependent FHE computation path. Independent deployed evidence is available through Blockscout below.

The frontend release gate is:

```bash
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run build
```

## Canonical cUSDC journey

Three wallets deposited 10, 30 and 60 cUSDC. The keeper funded a separate 50 cUSDC prize, completed the encrypted weighted draw, the winner revealed and claimed 50 cUSDC, and every wallet withdrew its original principal.

| Proof | Transaction | Gas / measurement |
|---|---|---|
| Deposit 10 | [`0xe17f…41bf`](https://sepolia.etherscan.io/tx/0xe17f9a91151282472d1ce58b1b8698760fb301e348f73827b27a472661aa41bf) | 704,045 gas; reveal 5.7s |
| Deposit 30 | [`0x018a…9937`](https://sepolia.etherscan.io/tx/0x018aa1014bce2b80f19bb996c5019301c525445bea39882ec3d220fcf59b9937) | 903,422 gas; reveal 5.1s |
| Deposit 60 | [`0x3f7a…c1e7`](https://sepolia.etherscan.io/tx/0x3f7a78a449bf6cd8b5d6c400ed1a02c1af4ae7bb69ef7bde467dfba5667dc1e7) | 903,418 gas; reveal 5.6s |
| Prize funding 50 | [`0xf791…19e5`](https://sepolia.etherscan.io/tx/0xf791b0fa1ea1a72af3f3467d03ce5b31ca45db97e4cd4094753da9d29ad419e5) | 541,410 gas |
| Draw request | [`0x8c8c…e72e`](https://sepolia.etherscan.io/tx/0x8c8c473c78a4f94d6a190b95caa9ec7df260a52ce9d4f445257b9381e354e72e) | 161,727 gas |
| Aggregate verification | [`0xb494…fe0c`](https://sepolia.etherscan.io/tx/0xb494decbce94b8278cee26a5356340be2b23905defae0d7e4089181b2971fe0c) | 1,239,521 gas |
| Encrypted selection | [`Etherscan`](https://sepolia.etherscan.io/tx/0x043053976a6029c381ccabc349ca3b64456d3cd7619707b16872d520b493c718) · [`Blockscout FHE operations`](https://eth-sepolia.blockscout.com/tx/0x043053976a6029c381ccabc349ca3b64456d3cd7619707b16872d520b493c718) | 881,640 gas; 27 FHE operations; 1,797,102 HCU; 899k max depth |
| Result verification | [`0x5880…3ac2`](https://sepolia.etherscan.io/tx/0x5880e5f8100aeb85f251bcc1306ded3c09b58fc3322d0abde9db760e93493ac2) | 441,397 gas |
| Winning claim 50 | [`Etherscan`](https://sepolia.etherscan.io/tx/0x8fcb680beb289e7134dfffd9fbfb6f424c58f974a58a4922c2910e30f82a660f) · [`Blockscout FHE operations`](https://eth-sepolia.blockscout.com/tx/0x8fcb680beb289e7134dfffd9fbfb6f424c58f974a58a4922c2910e30f82a660f) | 462,562 gas; 7 FHE operations; 586,064 HCU; 369k max depth; reveal 3.3s |
| Withdraw 10 | [`0xce02…98da`](https://sepolia.etherscan.io/tx/0xce02f8bc55bb1457fa04caf611a65e94de1e1845465cce3503e36bdb9c8498da) | 704,043 gas; reveal 3.6s |
| Withdraw 30 | [`0x27b6…7c15`](https://sepolia.etherscan.io/tx/0x27b6103ef1219325f9b34bd3ff97b01cc006e328f7b87a614851af0dee787c15) | 704,031 gas; reveal 2.9s |
| Withdraw 60 | [`0x1280…426d`](https://sepolia.etherscan.io/tx/0x1280fccbd8fc3d7f6fa51d86c4d8fbc9a5e7755c6d64c787b435316e7f38426d) | 704,039 gas; reveal 3.0s |

Goldsky restored the indexed history after browser storage was cleared and returned decryptable handles for the 50 claim, a zero claim, and all three withdrawals.

Blockscout's operation traces independently identify each FHE opcode, its inputs and resulting ciphertext handle, per-operation HCU, total transaction HCU and dependency depth. They expose the computation structure—not the encrypted amounts, random target, winner or winnings.

## Fresh-wallet cUSDT smoke journey

A one-use wallet completed faucet → Shield 15 → deposit/reveal 10 → fund 5 → draw → reveal/claim 5 → withdraw 10 → verify zero principal. The key existed only in memory and was not logged or persisted.

| Step | Transaction |
|---|---|
| Faucet | [`0x78aa…8f55`](https://sepolia.etherscan.io/tx/0x78aa9ac367f7c9c3325f8037c853eac2b7314b922cc9331447fd526846e08f55) |
| Shield | [`0xb2e5…5014`](https://sepolia.etherscan.io/tx/0xb2e542f6fe8fcd6088335cae0d61b85aa8a83c331a4f4eae3c3699f9ee765014) |
| Deposit | [`0xb0fb…a054`](https://sepolia.etherscan.io/tx/0xb0fbd108993b184e0e038c3fdb9a06942cfbe95c03331678254a8bcaadeea054) |
| Aggregate verification | [`0x311b…802d`](https://sepolia.etherscan.io/tx/0x311b0353712da370a84a81fcc7a8b30baa9248ed830eaf2fccd0950cdba5802d) |
| Encrypted selection | [`0x76e2…7ffb`](https://sepolia.etherscan.io/tx/0x76e2a111ce26851302250250ab6af785813db07c8e7af796c6044be46d137ffb) |
| Result verification | [`0xb05a…b536`](https://sepolia.etherscan.io/tx/0xb05a088e8e16dfe2e90a5ee24c07129e3fc21426206e788b1efc4606995cb536) |
| Claim | [`0x6d4c…d0e1`](https://sepolia.etherscan.io/tx/0x6d4c6c9ef15d8709779dbf26156f0c3c3caddcde6b4c4dedab2ad4c9c0d8d0e1) |
| Withdrawal | [`0x3fc8…508b`](https://sepolia.etherscan.io/tx/0x3fc8731204022bb964931cb5db68c9f7b1f14f60a292cb1e9e5da28defc3508b) |

## Permissionless fallback proof

An unprivileged caller requested a due draw and the keeper completed it: [request](https://sepolia.etherscan.io/tx/0x3d144a8db20b0cb333570420141c0f454d5d8dac090d80d8e3e49a5c72a5b5cd), [aggregate](https://sepolia.etherscan.io/tx/0xa9881762f5c70957dd3d3a4de0511e0bf7c4df017b48fd77e5dbfc0befa2cd48), [selection](https://sepolia.etherscan.io/tx/0x31e58f9f93e3cf672fd89086a71c0ff7b5fa0d8c3c21b5df1d69eece6e23b524), [result](https://sepolia.etherscan.io/tx/0x84c06de7f635a2ef70e16742702d7ac6f11bff38eb15bea34875a09f3cd0e500), [reopen](https://sepolia.etherscan.io/tx/0xa79837b17d48a2af960aee9ff34baaf55cfaf658987bb22b5de64204170df2ec).
