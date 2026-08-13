# ZamOps Pool contracts

Hardhat FHEVM workspace for the confidential prize pool.

The isolated `EncryptedWeightedDrawSpike` proves ACL correctness, unbiased encrypted randomness, deposit-weighted selection, and bounded execution. `ConfidentialPrizePool` promotes that engine into actual ERC-7984 custody with encrypted principal, a separately funded prize reserve, encrypted winnings, claims, and principal withdrawals in every lifecycle state. `ZamOpsPoolFactory` creates one independent shared pool per registry-valid confidential token.

## Local verification

```bash
npm install
npm run compile
npm test
```

## Sepolia spike rehearsal

1. Copy `.env.example` to `.env`.
2. Add an RPC URL and at least three unique funded Sepolia keys to `SEPOLIA_PRIVATE_KEYS`. Never commit this file or share the keys in chat.
3. Deploy a fresh spike:

   ```bash
   npm run deploy:sepolia:fresh
   ```

4. Run the three-wallet encrypted draw:

   ```bash
   npm run rehearse:sepolia
   ```

The rehearsal records encrypted weights of 10, 30, and 60; reveals only their aggregate; processes FHE randomness and selection; privately decrypts each wallet's weight and winnings; and fails unless weights are unchanged and exactly one prize unit was awarded. It prints transaction hashes, confirmation/decryption latency, gas, and HCU when the remote receipt exposes enough information.

This script must run against a freshly deployed spike because the current proof contract intentionally supports one draw. Use Node 22 as pinned by the repository `.nvmrc`.

### Validated Sepolia rehearsal — 2026-08-12

- Contract: `0x6D8bFd91cBf2FbD719dEd593782e027423fA1471`
- Deployment transaction: `0x302ec1ce528afa4686488896dd1dc7834dc9fc45a3b6c42e96563a4063ddd2e5`
- Chain ID: `11155111`
- Encrypted weights: 10, 30, and 60; aggregate disclosure: 100
- Result: passed on the first sampling attempt; weights remained unchanged and exactly one encrypted prize unit was awarded
- User decryption latency: 3.3–3.8 seconds per wallet when decrypting weight and winnings together
- Random sampler: 1,968,144 HCU, 607,000 maximum depth, 1,301,306 gas
- Three-participant selection batch: 1,797,070 HCU, 899,000 maximum depth, 859,957 gas

This contract is a completed one-draw technical spike, not the production pool address.

## Production Sepolia deployment

- Factory: `0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2`
- Faucet: `0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F`
- Registry: `0x2f0750Bbb0A246059d80e94c454586a7F27a128e`
- Draw interval: 3,600 seconds

| Asset | Pool | Faucet |
| --- | --- | --- |
| cUSDCMock | `0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327` | public mint |
| cUSDTMock | `0x2411d25929564Dc89502d02d502Be295703DdAf6` | public mint |
| cWETHMock | `0xd91358f869b26B9Ef61AA7A900111A98109CF41a` | public mint |
| cBRONMock | `0x95cc93C58F5386f1420F67F2C8ceBd8C05450452` | public mint |
| cZAMAMock | `0x9820488e1A5c7Dca5D57387c5f5D8ac35f140675` | public mint |
| ctGBPMock | `0xbbcAc223967DCF3dBfD6fbeC3D47AB98cCDf6bE8` | public mint |
| cXAUtMock | `0x1858B04892E3017F783dF51C21A191a88A452E05` | public mint |
| ctGBP | `0x88CDE42A020956167FA2c79Ffa26D7B5918Fb427` | inventory required |
| csteakcUSDC (Mock) | `0x29c1b12004E649cF67E3a2A37Fc24A91Bd9bf9a1` | inventory required |

Deploy or reconcile the registry dynamically with `npm run deploy:sepolia:pools`. Run the resumable full-cycle cUSDC rehearsal with `npm run rehearse:sepolia:pool`.

The deployed faucet's direct cUSDC path was validated on Sepolia with an exact 1,000 USDC balance increase in transaction `0x456f708910d9a5ff1a5d68826d505dc6c2f8e40c522fb3e5952da1fe25dde1c6`.

### Validated production rehearsal — 2026-08-12

The cUSDC pool completed the full three-wallet journey with encrypted 10/30/60 cUSDC principal, aggregate disclosure of 100 cUSDC, a separately funded 50 cUSDC prize, first-attempt FHE-weighted selection, winner-only EIP-712 decryption, confidential claim, and full principal withdrawal. Final privately decrypted pool principals were zero for all three wallets. Detailed hashes, gas, HCU, depth, and latency are retained in `private-notes/08-testing-and-release.md` during development.

HCU means **homomorphic complexity units**: the FHE work of encrypted operations, separate from EVM gas. The scripts measure confirmation latency around transaction submission/receipt, decryption latency around SDK calls, gas from `receipt.gasUsed`, and HCU/dependency depth from FHE operation logs.

### Canonical Phase 3 release journey — 2026-08-13

Factory `0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2` and cUSDC pool `0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327` completed the fresh 10/30/60 journey. The keeper funded and completed draw #3, wallet three claimed exactly 50 cUSDC, all principals were withdrawn, and final principal decryptions were zero. Goldsky restored and user-decrypted the exact three deposits, three withdrawals, positive claim and subsequent zero-value diagnostic claim. Run `npm run phase3:prepare:cusdc`, `npm run phase3:finalize:cusdc`, `npm run phase3:verify-indexed:cusdc` and `npm run phase3:verify-indexed-final:cusdc` for the guarded evidence workflow.

## Keeper operations and reports

`npm run keeper:sepolia` inspects every pool in the canonical factory and advances only eligible, non-empty draws. All transition methods are permissionless; the configured wallet provides timing and gas but has no winner-selection authority.

The production workflow runs every ten minutes against a one-hour draw interval, so a healthy draw usually completes approximately 60–70 minutes after the pool reopens. GitHub schedules can be delayed. The frontend therefore exposes **Help advance draw** 20 minutes after eligibility, allowing any saver to submit the same next state-machine step.

Set `KEEPER_REPORT_PATH=reports/pool-keeper.json` to retain a structured report. In GitHub Actions, each run also writes a step summary and uploads that JSON for 30 days. The report records confirmed/skipped/failed actions, transaction hashes, actual gas, keeper balances, RPC block freshness, Goldsky indexing health, faucet-sponsor authorization/balance, and alerts. `KEEPER_MIN_BALANCE_ETH` and `KEEPER_FAUCET_SPONSOR_MIN_BALANCE_ETH` default to `0.02`; `KEEPER_RPC_MAX_BLOCK_AGE_SECONDS` defaults to `180`; `KEEPER_STALL_THRESHOLD_MINUTES` defaults to `20`. A failed action, low monitored balance, stale RPC, unhealthy indexer, or stalled draw makes the run fail visibly.

For an explicit single-pool rehearsal, set `KEEPER_POOL_ADDRESS`. Scheduled production runs leave it unset and inspect the entire canonical factory.

Recovery order:

1. Inspect the failed run summary and JSON artifact.
2. Top up the keeper if the low-balance alert fired, then manually dispatch the workflow.
3. If automation remains unavailable, run the keeper with another funded Sepolia key or use the delayed in-app fallback until the pool reopens.

For a deliberately manual recovery, `npm run fallback:sepolia` submits exactly one next step and exits. It defaults to signer index `1` and the canonical cUSDC pool; override `FALLBACK_SIGNER_INDEX` or `FALLBACK_POOL_ADDRESS` when rehearsing another caller or pool. Re-run it only when another single step is intentionally required.

Never expose `KEEPER_PRIVATE_KEY` to the frontend or grant the keeper privileged contract roles.
