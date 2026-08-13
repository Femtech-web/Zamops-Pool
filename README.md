# ZamOps Pool

### Save privately. Win fairly. Keep your principal.

ZamOps Pool is a no-loss prize-savings prototype built on [Zama FHEVM](https://docs.zama.ai/protocol). Deposit confidential ERC-7984 tokens, receive encrypted odds proportional to your savings, and withdraw your principal independently of the draw. Amounts, balances, selection and winnings remain encrypted while the protocol runs on a public chain.

> **Release status:** canonical contracts and complete multi-wallet journeys are live on Sepolia. The final frontend URL will be added after the stable build is deployed manually.

| | |
|---|---|
| Network | Ethereum Sepolia (`11155111`) |
| Live app | Pending manual frontend deployment |
| FHE | Zama FHEVM Solidity `0.11.1`, relayer SDK `0.4.1` |
| Confidential token standard | OpenZeppelin ERC-7984 |
| Activity index | Goldsky |
| Canonical factory | [`0xEB98…4Aa2`](https://sepolia.etherscan.io/address/0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2) |

## Judge path: understand it in three minutes

1. Connect MetaMask or Rabby on Sepolia and claim a faucet token.
2. Open **Tokens**, Shield part of the public balance, and reveal/hide confidential balances.
3. Deposit into a pool and explicitly reveal **Your principal**.
4. Open **Activity** and reveal the encrypted amount inline or in its detail sheet.
5. Show the automated draw status and permissionless delayed fallback.
6. Reveal winnings, claim the prize, then withdraw the unchanged principal.

The full prepared route is in the [judge demo guide](docs/judge-demo-guide.md). Existing on-chain journeys can be audited immediately in [testing and release evidence](docs/testing-and-release-evidence.md).

## Why this is different

Public prize pools reveal how much every saver contributes, making balances, odds and outcomes easy to profile. ZamOps Pool moves the important accounting and selection work into FHE:

- principal, per-user odds, prize reserves and winnings are encrypted;
- weighted selection scans encrypted cumulative balances against an encrypted random target;
- a winner learns through their decryptable winnings balance rather than a public winner event;
- indexed activity stores encrypted handles, so history can be restored without publishing readable amounts;
- all draw progression is permissionless—the keeper improves liveness but has no special draw authority.

## How it works

```mermaid
flowchart LR
  A["Faucet token"] --> B["Shield into ERC-7984"]
  B --> C["Encrypted pool deposit"]
  C --> D["Encrypted weighted draw"]
  D --> E["Private winnings"]
  E --> F["Confidential claim"]
  C --> G["Principal withdrawal at any stage"]
```

The pool keeps principal, prize reserve and winnings separate. Losing changes neither principal ownership nor withdrawal rights. The testnet keeper funds prizes with mock yield; it does not take funds from savers.

The draw interval is 60 minutes and automation checks every 10 minutes. A healthy draw therefore normally completes approximately **60–70 minutes after the pool reopens**, plus normal Sepolia and Zama decryption latency. If automation is delayed, the UI offers any wallet the next valid permissionless step after about 80 minutes.

Read [draw fairness and accounting](docs/draw-fairness-and-accounting.md) for weighted selection, rejection sampling, empty draws and the no-loss invariant.

## Privacy at a glance

| Information | Visibility |
|---|---|
| Deposit, withdrawal and claim amounts | Encrypted; user-revealable when ACL permits |
| Principal, odds and winnings | Encrypted |
| Random target and individual selection comparisons | Encrypted |
| Winner identity | Not emitted as readable draw data |
| Aggregate eligible weight | Publicly decrypted for proof-backed progression |
| Wallet addresses, transaction timing and lifecycle state | Public blockchain metadata |

FHE provides value confidentiality, not anonymity. The complete boundary and ACL lifecycle are documented in [architecture and privacy](docs/architecture-and-privacy.md).

## Canonical Sepolia deployment

### Infrastructure

| Contract / account | Address |
|---|---|
| Zama wrapper registry | [`0x2f07…128e`](https://sepolia.etherscan.io/address/0x2f0750Bbb0A246059d80e94c454586a7F27a128e) |
| ZamOps pool factory | [`0xEB98…4Aa2`](https://sepolia.etherscan.io/address/0xEB98e21687d099d3c2F222E69fC728F1f6904Aa2) |
| ZamOps faucet | [`0x6148…Cc9F`](https://sepolia.etherscan.io/address/0x6148D5A8B6023CC52aC3cc71d22a7340B5b2Cc9F) |
| Keeper | [`0xcc88…1c54`](https://sepolia.etherscan.io/address/0xcc886a72f79BaEd0098432704a65373F52131c54) |
| Faucet sponsor | [`0xd04B…3AF1`](https://sepolia.etherscan.io/address/0xd04BBA49865f57840D4F03CCf541961906843AF1) |

### Pools

| Asset | Confidential wrapper | Pool | Prize mode |
|---|---|---|---|
| cUSDC | [`0x7c5b…3639`](https://sepolia.etherscan.io/address/0x7c5bf43b851c1dff1a4fee8db225b87f2c223639) | [`0x2Eeb…D327`](https://sepolia.etherscan.io/address/0x2Eeb28cB5fF0C3339163e3779794ac8a19BCD327) | Keeper mock yield: 50 |
| cUSDT | [`0x4e7b…4491`](https://sepolia.etherscan.io/address/0x4e7b06d78965594eb5ef5414c357ca21e1554491) | [`0x2411…dAf6`](https://sepolia.etherscan.io/address/0x2411d25929564Dc89502d02d502Be295703DdAf6) | Keeper mock yield: 25 |
| cWETH | [`0x4620…3158`](https://sepolia.etherscan.io/address/0x46208622da27d91db4f0393733c8ba082ed83158) | [`0xd913…F41a`](https://sepolia.etherscan.io/address/0xd91358f869b26B9Ef61AA7A900111A98109CF41a) | Keeper mock yield: 1 |
| cBRON | [`0xaa56…c891`](https://sepolia.etherscan.io/address/0xaa5612fa27c927a0c7961f5aefee5ba3a0f9c891) | [`0x95cc…0452`](https://sepolia.etherscan.io/address/0x95cc93C58F5386f1420F67F2C8ceBd8C05450452) | Keeper mock yield: 100 |
| cZAMA | [`0xf2d6…bfb`](https://sepolia.etherscan.io/address/0xf2d628d2598af4eaf94cb76a437ff86ca78ffbfb) | [`0x9820…0675`](https://sepolia.etherscan.io/address/0x9820488e1A5c7Dca5D57387c5f5D8ac35f140675) | Keeper mock yield: 100 |
| ctGBP mock | [`0xfce5…f7cc`](https://sepolia.etherscan.io/address/0xfce5c7069c5525ef6c8c2b2e35a745ba20a2f7cc) | [`0xbbcA…6bE8`](https://sepolia.etherscan.io/address/0xbbcAc223967DCF3dBfD6fbeC3D47AB98cCDf6bE8) | Keeper mock yield: 50 |
| cXAUt | [`0xe4fc…60c7`](https://sepolia.etherscan.io/address/0xe4fcf848739845bc81dee1d5352cf3844f0a60c7) | [`0x1858…2E05`](https://sepolia.etherscan.io/address/0x1858B04892E3017F783dF51C21A191a88A452E05) | Keeper mock yield: 1 |
| ctGBP inventory | [`0x167d…a208`](https://sepolia.etherscan.io/address/0x167dc962808b32cfffc7e14b5018c0be06a3a208) | [`0x88CD…b427`](https://sepolia.etherscan.io/address/0x88CDE42A020956167FA2c79Ffa26D7B5918Fb427) | Sponsor inventory required |
| csteakcUSDC | [`0x13f7…28c4`](https://sepolia.etherscan.io/address/0x13f7d34a4f0102734f19e3ff16e068fe194b28c4) | [`0x29c1…f9a1`](https://sepolia.etherscan.io/address/0x29c1b12004E649cF67E3a2A37Fc24A91Bd9bf9a1) | Sponsor inventory required |

Source verification is run with `npm --prefix contracts run verify:canonical:sepolia`; it requires a local `ETHERSCAN_API_KEY`.

## Tested evidence

| Layer | Result | Evidence |
|---|---|---|
| Solidity | 24 passing tests | Confidential accounting, draw boundaries, retries, lifecycle, ACLs, faucet and limits |
| cUSDC | Complete three-wallet journey | 10/30/60 deposits, 50 prize, claim, all principal withdrawn |
| cUSDT | Complete fresh-wallet smoke | Faucet, Shield, deposit, draw, claim, withdraw, final zero |
| Permissionless fallback | Passed | Unprivileged request followed by automated completion |
| Goldsky restore | Passed | Activity recovered after browser storage clear |
| Indexed private amounts | Passed | Deposit, withdrawal and positive/zero claim handles decrypted |
| FHE measurements | Captured | Gas, HCU, max depth and decryption timing |

Every canonical transaction link and measurement is in [testing and release evidence](docs/testing-and-release-evidence.md).

## Run locally

Requirements: Node.js 20+, npm, a Sepolia RPC URL, and a browser wallet on Sepolia.

```bash
git clone <repository-url>
cd zamops-pool

cp contracts/.env.example contracts/.env
cp app/.env.example app/.env

npm --prefix contracts install
npm --prefix app install
npm --prefix contracts run compile
npm --prefix contracts test
npm --prefix app run dev
```

Open `http://localhost:3000`. Environment variables are documented in the example files. Keep private keys server-side and set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin before the production frontend build.

## Release checks

```bash
npm --prefix contracts test
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run build
```

For deploy, verification, keeper health and recovery instructions, see [deployment and operations](docs/deployment-and-operations.md).

## Repository map

| Path | Purpose |
|---|---|
| `contracts/contracts/` | Pool, factory, faucet, interfaces and test harnesses |
| `contracts/test/` | Confidential contract test suite |
| `contracts/scripts/` | Keeper, fallback, verification and Sepolia rehearsals |
| `app/src/app/` | Next.js App Router routes and metadata |
| `app/src/features/` | Pool, token, activity and shell features |
| `app/src/i18n/` | Complete EN, ES, FR, ZH, KO and VI catalogs |
| `subgraph/` | Goldsky indexing schema and mappings |
| `.github/workflows/` | Keeper automation and health reporting |
| `docs/` | Public architecture, security, testing, operations and demo docs |

## Documentation

- [Documentation index](docs/README.md)
- [Architecture and privacy](docs/architecture-and-privacy.md)
- [Draw fairness and accounting](docs/draw-fairness-and-accounting.md)
- [Deployment and operations](docs/deployment-and-operations.md)
- [Testing and release evidence](docs/testing-and-release-evidence.md)
- [Security and limitations](docs/security-and-limitations.md)
- [Judge demo guide](docs/judge-demo-guide.md)

## Security posture

Pools are non-upgradeable and have no owner, pause key or winner override. The keeper has no privileged contract path. This remains a Sepolia prototype using mock yield and has not been independently audited; the concrete limitations and mainnet requirements are listed in [security and limitations](docs/security-and-limitations.md).

## License

MIT
