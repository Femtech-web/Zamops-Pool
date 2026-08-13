# Deployment and operations

## Environment

Copy the example files and supply values locally:

```bash
cp app/.env.example app/.env
cp contracts/.env.example contracts/.env
```

`NEXT_PUBLIC_SITE_URL` must be the final HTTPS origin without a trailing slash. It drives canonical metadata, Open Graph URLs, `robots.txt`, `sitemap.xml`, and the web manifest. Secrets belong only in local environment files or GitHub Actions secrets; never put private keys in `NEXT_PUBLIC_*` values.

## Build and test

```bash
npm --prefix contracts install
npm --prefix contracts run compile
npm --prefix contracts test

npm --prefix app install
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run build
```

## Deploy and verify

```bash
npm --prefix contracts run deploy:sepolia:pools
npm --prefix contracts run verify:canonical:sepolia
```

Canonical verification requires `ETHERSCAN_API_KEY` in `contracts/.env`. The verification command contains the deployed constructor arguments for the factory, faucet and all nine pools, and safely accepts contracts Etherscan has already verified.

## Keeper timing

The draw interval is 60 minutes. The production workflow checks every 10 minutes. Because a keeper check must occur after `nextDrawAt`, a healthy draw will usually complete approximately **60–70 minutes after the pool reopens**, plus normal Sepolia confirmation and Zama public-decryption latency.

The workflow:

1. checks RPC and Goldsky freshness;
2. checks keeper and sponsor balances;
3. funds the configured mock prize only when a draw is eligible;
4. advances every pending lifecycle step;
5. waits for proof-backed public decryptions where required;
6. publishes a Markdown summary and structured JSON report;
7. emits actionable GitHub annotations on failures.

### GitHub Actions environment

The keeper job targets the GitHub Environment named `Zamops-pool`. Configure these values inside that environment:

| Type | Name | Purpose |
|---|---|---|
| Secret | `KEEPER_PRIVATE_KEY` | Unprivileged keeper signer |
| Secret or variable | `SEPOLIA_RPC_URL` | Sepolia JSON-RPC endpoint |
| Variable | `KEEPER_PRIZE_CONFIG_JSON` | Per-pool mock-yield funding policy |
| Variable | `KEEPER_ENABLED` | Set to `false` to skip the entire keeper job; unset or `true` to run it |
| Variable | `KEEPER_FUNDING_ENABLED` | Set to `false` to stop mock-prize funding while monitoring and draw advancement continue |

Environment-scoped secrets are not exposed to a job unless the workflow declares `environment: Zamops-pool`. The workflow does so and validates the RPC URL and keeper key before dependency installation. If the environment has required-review protection, scheduled runs will wait for approval; avoid that protection rule for unattended ten-minute automation.

### Pausing automation

Use the non-secret GitHub Environment variable `KEEPER_ENABLED` as the master switch. Set it to `false` to pause all scheduled and manually dispatched keeper execution. The job is skipped before setup, so it submits no transactions and spends no keeper gas. Set it back to `true` (or delete the variable) to resume on the next ten-minute schedule.

`KEEPER_FUNDING_ENABLED` is narrower. When it is `false`, the keeper does not prepare new mock prizes, but it still inspects services and pools and advances any eligible or in-progress draw. It can therefore still spend gas. Disabling funding does not remove a prize already deposited in a pool.

Pausing the offchain keeper does not pause the contracts. Principal remains withdrawable, and after the documented delay the frontend's permissionless fallback can allow a saver to advance a due draw.

## Delayed permissionless fallback

The UI does not compete with healthy automation. Once an eligible draw has remained untouched for about 80 minutes after reopening, it offers any saver the next valid permissionless step. The action advances one state transition; it cannot choose a winner or bypass cryptographic proof checks.

## Monitoring thresholds

Operators should alert on stale RPC/indexer blocks, insufficient keeper gas, insufficient faucet sponsor gas, repeated proof/decryption failures, or a pool remaining in a non-open state across multiple runs. The keeper report includes state, draw ID, participant count, next-draw time, transactions, gas, HCU/depth when available, and latency.

After each confirmed lifecycle transaction, the keeper reads the pool at that receipt's exact block number. This avoids repeating a completed transition when a load-balanced public RPC briefly serves a stale `latest` state. Keep the keeper comfortably above the configured ETH floor; a multi-pool FHE draw can require several comparatively expensive transactions in one run.

## Release sequence

1. Run contract and frontend checks.
2. Verify the canonical contracts on Etherscan.
3. Deploy the exact successful frontend build.
4. set `NEXT_PUBLIC_SITE_URL` to the public origin and rebuild if necessary.
5. Run the [judge demo journey](judge-demo-guide.md) through MetaMask or Rabby on the public URL.
6. Retain screenshots and transaction links for the submission.
