# ZamOps Pool subgraph

This subgraph is the canonical read projection for factory-created Sepolia pools. It indexes public transaction metadata and user-authorized encrypted amount handles; it never receives EIP-712 signatures or decrypted values.

Before deployment, set the versioned factory address and deployment block in `subgraph.yaml`, then run:

```bash
npm install
npm run build
npm run deploy:sepolia
```

Production is deployed through Goldsky. Authenticate with a Goldsky CLI API token, build the subgraph, and run `npm run deploy:sepolia`. Never commit the CLI token.

Public Sepolia endpoint:

`https://api.goldsky.com/api/public/project_cmsqxy20s9sno01ulf3j3aoqt/subgraphs/zamops-pool-sepolia/v0.0.1/gn`

The frontend receives only the deployed GraphQL endpoint through `NEXT_PUBLIC_ZAMOPS_POOL_SUBGRAPH_URL`. Clear amounts remain in browser memory and are removed when the user selects Hide.
