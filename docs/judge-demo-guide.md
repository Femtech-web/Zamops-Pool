# Judge demo guide

## Fast evaluation

1. Open the deployed app on desktop with MetaMask or Rabby set to Sepolia.
2. Connect a fresh wallet and request a faucet asset.
3. Open **Tokens**, Shield part of the public balance, then use **Reveal all balances** and **Hide all**.
4. Return to the pool, deposit a private amount, and reveal/hide **Your principal**.
5. Open **Activity**, reveal the encrypted amount inline, hide it, open the detail sheet, and reveal it again.
6. Show the draw status and explain that automation checks every ten minutes; completion normally occurs about 60–70 minutes after reopening.
7. After completion, reveal winnings, claim, and withdraw principal.

## Full confidential journey

`faucet → Shield → deposit → reveal principal → automated draw → reveal winnings → claim → withdraw`

Use cUSDC for the primary journey and cUSDT for a shorter smoke journey. Deposit from multiple wallets when demonstrating weighted odds.

## What to point out

- Amounts show bullets until that connected saver explicitly decrypts them.
- Activity can be reconstructed from Goldsky after clearing browser storage without exposing readable values.
- Principal and winnings are separate: losing never transfers principal to another saver.
- Any wallet can continue a delayed draw; the keeper provides availability, not authority.
- A hidden zero balance is privately checked before Claim or Withdraw, so zero-value transactions do not reach the wallet.
- Light/dark and language preferences survive refreshes.

## Timing expectations

The pool interval is one hour and the keeper polls every ten minutes. Therefore completion normally lands approximately 60–70 minutes after a pool reopens, plus Sepolia and Zama decryption latency. For a short presentation, prepare a due draw beforehand or use the retained transaction evidence in [testing and release evidence](testing-and-release-evidence.md).

## Submission capture

Retain screenshots of the connected pool, hidden/revealed principal, hidden/revealed winnings, Activity restoration, inline encrypted-amount reveal, Tokens reveal-all, successful claim, successful withdrawal, and the relevant Etherscan transactions. Never include seed phrases, private keys, environment files, or wallet extension secrets.

