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

- Factory: `0x9f808ffE49BC790C569845D50be9B132dbdeEe63`
- Faucet: `0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F`
- Registry: `0x2f0750Bbb0A246059d80e94c454586a7F27a128e`
- Draw interval: 3,600 seconds

| Asset | Pool | Faucet |
| --- | --- | --- |
| cUSDCMock | `0x480cAb3845809519FA339Fe279863164E0E75234` | public mint |
| cUSDTMock | `0xa3C37dE0D122e2a980EBA285164C07CD5c9eC136` | public mint |
| cWETHMock | `0x28103781578747b32537A00Dc04893cD929933bB` | public mint |
| cBRONMock | `0x2820521854bA09B510FBe200A5FB9d7CEBC7cF6c` | public mint |
| cZAMAMock | `0xA138F0aAb2E2d974179d09535BfDF26ca2f14048` | public mint |
| ctGBPMock | `0x35F64dF757f8E066A867985c15dB9f82f1061FCE` | public mint |
| cXAUtMock | `0x50Fef562e9b9FC0DeE18162572a49fa95Fc3cD3a` | public mint |
| ctGBP | `0x661741e7aedcd3c5B2Ab5BCAa5fb6410c05A8c11` | inventory required |
| csteakcUSDC (Mock) | `0x6a24545b8C0Bb40Dc90cf10f0d2B576B4bA5635E` | inventory required |

Deploy or reconcile the registry dynamically with `npm run deploy:sepolia:pools`. Run the resumable full-cycle cUSDC rehearsal with `npm run rehearse:sepolia:pool`.

The deployed faucet's direct cUSDC path was validated on Sepolia with an exact 1,000 USDC balance increase in transaction `0x456f708910d9a5ff1a5d68826d505dc6c2f8e40c522fb3e5952da1fe25dde1c6`.

### Validated production rehearsal — 2026-08-12

The cUSDC pool completed the full three-wallet journey with encrypted 10/30/60 cUSDC principal, aggregate disclosure of 100 cUSDC, a separately funded 50 cUSDC prize, first-attempt FHE-weighted selection, winner-only EIP-712 decryption, confidential claim, and full principal withdrawal. Final privately decrypted pool principals were zero for all three wallets. Detailed hashes, gas, HCU, depth, and latency are retained in `private-notes/08-testing-and-release.md` during development.

HCU means **homomorphic complexity units**: the FHE work of encrypted operations, separate from EVM gas. The scripts measure confirmation latency around transaction submission/receipt, decryption latency around SDK calls, gas from `receipt.gasUsed`, and HCU/dependency depth from FHE operation logs.
