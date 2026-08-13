# ZamOps Pool

Private savings. Fair prizes. Principal protected.

ZamOps Pool is a confidential prize-savings application built with Zama FHEVM and ERC-7984 on Ethereum Sepolia. Each supported confidential token has its own shared pool. Users receive deposit-weighted chances in that asset's periodic draws, privately reveal their balance and winnings, and withdraw their full principal at any time.

## Workspace

- `app/` — Next.js App Router frontend, feature-based UI, six-locale foundation, wallet/FHE boundaries, Pool/Tokens/Activity routes, and light/dark themes.
- `subgraph/` — factory-aware Graph index that stores public transaction metadata and encrypted amount handles only.
- `contracts/` — Hardhat FHEVM workspace for the confidential pool, tests, deployment, and verification.
- `private-notes/` — local living product, architecture, design, implementation, testing, and submission context. This directory is intentionally gitignored.

## Initial technical boundary

The core pool does not require a backend or Supabase. Sepolia contracts are the source of truth. The activity subgraph provides scalable wallet history and stores ciphertext handles, never clear confidential amounts. Faucet sponsorship remains a narrow server route; neither service is a custody or privacy authority.

## Start here

1. Read `private-notes/00-context-index.md`.
2. Read `private-notes/03-architecture-and-privacy.md` before implementing contracts.
3. Work from `private-notes/07-implementation-plan.md` and keep decisions current in `private-notes/09-decisions-and-changelog.md`.

## Development

```bash
cd app
npm install
npm run dev
```

The weighted-draw engine and versioned production ERC-7984 pools are deployed on Sepolia. The frontend discovers token-specific pools from factory `0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2` and includes faucet, shield/unshield, encrypted deposits, EIP-712 reveals, prize claims, no-loss withdrawals, state-aware draw progression, and indexed activity details. Goldsky indexes the factory and all nine pools at the configured public GraphQL endpoint. The fresh-wallet end-to-end browser rehearsal against this release is the current release gate.

## Demo yield and no-loss accounting

Sepolia uses a separately funded mock-yield reserve, which the bounty explicitly permits. A sponsor acquires confidential tokens and calls `fundPrize` on the matching token pool. The pool records the received amount in encrypted prize accounting; it never increases or decreases participant principal. When a draw starts, the encrypted reserve is frozen as that draw's prize. The encrypted weighted selection credits it to exactly one participant's encrypted winnings, and the winner claims it through an ERC-7984 confidential transfer.

This mock models the output of a real yield strategy, not fake interest on user balances. A production yield adapter would realize yield in the same asset, shield it if necessary, and contribute only that realized surplus through the existing prize-funding boundary. It would require a separate audit before receiving any authority over principal.

## Confidentiality and intentional disclosure

Individual deposits, current principal, odds, random target, winner identity, winnings, and prize transfers remain encrypted. Wallet addresses, pool membership, transaction timing, participant count, draw schedule, and lifecycle calls are public. The live aggregate pool total is not continuously visible. At draw start, the frozen aggregate deposit weight is publicly decrypted so the contract can derive an unbiased FHE randomness range; this draw-time aggregate disclosure is intentional and documented. It does not reveal an individual's balance, although very small pools provide weaker anonymity sets.

Goldsky endpoint: `https://api.goldsky.com/api/public/project_cmsqxy20s9sno01ulf3j3aoqt/subgraphs/zamops-pool-sepolia/v0.0.3/gn`

## Draw and prize automation

Every pool has an onchain repeated draw schedule. A countdown reaching zero makes the next draw eligible; it cannot execute a transaction by itself. The unprivileged keeper in `contracts/scripts/run-pool-keeper-sepolia.ts` supplies timing and gas while the contracts retain all authority over FHE randomness, eligibility, winner selection and accounting.

The keeper runs safely across the canonical factory:

- skips pools with no participants;
- skips open draws whose timer has not expired;
- automatically funds an active public-mint pool at most once for its next draw;
- advances request, aggregate verification, encrypted selection batches, result verification and next-draw synchronization;
- cannot read individual balances, choose a winner or withdraw principal;
- leaves every draw transition permissionless so a saver or the fallback script can recover a delayed draw.

Run it once locally:

```bash
cd contracts
KEEPER_DRY_RUN=true npm run keeper:sepolia
npm run keeper:sepolia
```

The scheduled workflow is `.github/workflows/pool-keeper.yml`. Configure these GitHub Actions secrets before enabling production automation:

- `SEPOLIA_RPC_URL`
- `KEEPER_PRIVATE_KEY`

The keeper wallet needs only Sepolia ETH plus access to the supported test-token faucet. Optional prize overrides belong in the repository variable `KEEPER_PRIZE_CONFIG_JSON`; never put the keeper private key in a frontend environment variable.

### Pool funding categories

- **Flagship funded pool:** cUSDC is the canonical judge/demo path. Its active draw is kept prize-ready with a separately funded confidential 50 cUSDC mock-yield prize.
- **Automatic faucet-funded pools:** cUSDC, cUSDT, cWETH, cBRON, cZAMA, ctGBP and cXAUt receive their configured prize only after a saver has joined. The keeper obtains official Sepolia test assets, shields them and calls `fundPrize`; principal is never used.
- **Sponsorship-required pools:** registry-valid assets without an approved public faucet policy—currently the inventory-only ctGBP wrapper at `0x167d…a208` and csteakcUSDC—remain usable for savings but are labelled `Awaiting sponsorship` until a sponsor supplies a confidential prize. Inventory-only assets are never fabricated by automation.

An empty draw returns its encrypted prize to the reserve. The keeper and indexer preserve that funded state, preventing duplicate automatic funding. Prize status is event-derived and public, but the funded amount, individual principal, odds, winner and winnings remain encrypted. A real yield adapter can later replace the mock sponsor without changing pool accounting: it supplies only the separately accounted prize reserve.
