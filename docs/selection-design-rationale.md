# Selection design rationale

**Status:** Accepted for the bounded Sepolia prototype  
**Decision:** Use an encrypted snapshot, a dense cumulative-weight range and rejection-sampled FHE randomness.

## Executive summary

ZamOps Pool defines draw fairness as follows:

> At the instant `requestDraw()` is mined, every encrypted unit of eligible principal receives exactly one position in the draw range.

If saver `i` has encrypted weight `wᵢ` and the frozen combined weight is `T`, the contract selects an encrypted target uniformly from `[0, T)` and awards the prize to the cumulative interval containing that target. The resulting probability is exactly:

```text
P(saver i wins) = wᵢ / T
```

This is a snapshot-weighted design, not a time-weighted design. A deposit present for the final minute receives the same per-unit probability as a deposit present for the full round. That is an accepted tradeoff, not an accidental or hidden property.

The design was selected because this prototype prioritizes:

1. exact deposit-proportional odds;
2. a winner for every valid non-empty draw;
3. encrypted individual balances, weights, random target and result;
4. principal withdrawal throughout every draw state;
5. bounded, measurable FHE execution; and
6. a mechanism that can be explained and independently tested end to end.

It was not selected because snapshot weighting is universally superior. A production system whose economic goal is specifically to reward deposit duration should reconsider TWAB or a simpler eligibility-delay design.

## Decision drivers

The deployed prototype had to satisfy several constraints simultaneously:

- winner selection must be onchain, random and deposit-weighted;
- individual deposits and balances must stay encrypted;
- the random target and per-user comparisons should remain encrypted;
- no keeper or offchain service may supply randomness or choose a winner;
- principal must remain withdrawable while the draw progresses;
- public-decryption callbacks must not expose individual balances;
- every FHE-heavy transaction must remain below Zama's global and sequential HCU limits; and
- the entire mechanism must be reproducible with local tests and deployed transaction evidence.

Zama documents HCU as a separate metering system for homomorphic computation, with both global work and sequential-depth limits. This makes encrypted state-history and selection structure an execution concern, not merely a storage concern. See [Zama's HCU guide](https://docs.zama.org/protocol/solidity-guides/development-guide/hcu).

## Selected mechanism

### 1. Freeze one encrypted snapshot

While the pool is Open, deposits and withdrawals update encrypted principal and eligible weight. Once the deadline has passed, any caller may submit `requestDraw()`. That transaction freezes:

- the encrypted weight of each participant;
- the encrypted combined eligible weight; and
- the separately funded encrypted prize.

Deposits then close until the pool reopens. Withdrawals remain available, but they do not rewrite the already-frozen odds for the current draw; synchronization rebuilds the following draw's weights from current principal.

### 2. Reveal only the combined range size

The combined eligible weight `T` is publicly decrypted with a signed proof. Individual `wᵢ` values remain encrypted. Revealing `T` provides the clear upper bound needed for bounded FHE randomness and makes the probability model externally understandable, at the accepted cost of leaking the aggregate pool weight once per draw.

### 3. Remove modulo bias

Zama's bounded encrypted randomness requires a power-of-two upper bound. The contract therefore chooses the next power of two `U ≥ T`, creates eight encrypted candidates in `[0, U)`, and encryptedly selects the first candidate below `T`. Zama documents that bounded `FHE.randEuintXX` produces encrypted randomness in a power-of-two range. See [Zama's encrypted randomness guide](https://docs.zama.org/protocol/solidity-guides/smart-contract/operations/random).

Using `candidate % T` would be biased whenever `U` is not divisible by `T`. Rejection sampling instead makes every accepted target in `[0, T)` equally likely.

Because `T > U / 2` whenever `T` is not already a power of two, one candidate is invalid with probability below `1/2`. The probability that all eight candidates are invalid is therefore below:

```text
(1/2)⁸ = 1/256 ≈ 0.390625%
```

If all eight are invalid, the proof-backed result is false and the permissionless state machine samples again. It does not award a biased target or silently skip the prize.

### 4. Fill one dense cumulative range

For deposits of 10, 30 and 60, the encrypted intervals are:

```text
0          10                         40                                                           100
| Alice 10 |          Bob 30          |                         Carol 60                            |
```

The contract scans encrypted cumulative weights and awards the prize to the first prefix greater than the encrypted target. The intervals exactly cover `[0, T)`:

- there are no unused positions;
- weight is not capped by a fixed slot size;
- every positive unit contributes equally to probability; and
- a valid target in a non-empty range maps to exactly one saver.

Selection is processed in batches of at most eight participants. This preserves the exact global distribution while keeping each transaction bounded.

## Alternatives considered

| Approach | Advantage | Reason not selected for this prototype |
|---|---|---|
| Equal chance per wallet | Very simple selection | A saver can split capital across wallets; odds are not deposit-weighted. |
| Plaintext ticket or cumulative balances | Cheap and easy to audit | Publishes individual deposits or odds, violating the core confidentiality goal. |
| Offchain RNG or offchain winner calculation | Can scale without FHE selection cost | Introduces an authority that can observe or influence selection and does not satisfy onchain FHE randomness. |
| Encrypted random value reduced with `% T` | Avoids retry logic | Produces modulo bias when the source range is not an exact multiple of `T`. |
| Time-weighted average balance (TWAB) | Rewards both amount and duration; discourages last-minute deposits | Requires historical/checkpoint accounting, time multiplication, wider cumulative values and a clear policy for eligibility retained after withdrawal. Under FHE, those updates add encrypted work to deposits and withdrawals and increase the state/overflow surface. |
| Fixed-capacity participant slots, including ORD-style designs | Per-participant checks can be more independent and scalable | Slot caps can saturate large weights; unused slot space or power-of-two padding can create no-winner outcomes; probabilities are not necessarily normalized by the current total. |
| Deposit activation in the following draw | Prevents last-minute entry with much less machinery than TWAB | Makes a new saver wait through an entire round and requires separate current/next-round eligibility UX. |
| Snapshot plus dense cumulative ranges | Exact `wᵢ/T` odds, no dead space, direct encrypted comparisons and clean withdrawal semantics | Gives full current-draw weight to every deposit made before the snapshot and scales linearly across bounded batches. **Selected.** |

“Oblivious Range Draw” is not an ERC or Zama standard. It is a project-specific name for a fixed-capacity encrypted slot construction. The relevant comparison here is between the properties of fixed padded slots and a dense total-weight range, not between project brands.

## Why TWAB was not selected

TWAB is a legitimate and mature prize-savings technique. PoolTogether defines it as the average balance held between two timestamps and maintains timestamped cumulative-balance observations whenever balances change. See [PoolTogether's TWAB design](https://dev.pooltogether.com/protocol/design/twab-controller/) and [TwabController reference](https://dev.pooltogether.com/protocol/reference/twab-controller/twabcontroller/).

For a 60-minute round:

- 60 units held for all 60 minutes produce an average weight of 60;
- 60 units held only for the final 5 minutes produce an average weight of 5.

That is preferable when the intended reward is explicitly **capital over time**. ZamOps currently rewards **capital present at the draw snapshot**. Both are coherent definitions, but they answer different product questions.

An encrypted TWAB version would also need to resolve details that the snapshot model avoids:

1. **Encrypted cumulative history.** Each balance change must incorporate `previousBalance × elapsedTime` without exposing the balance.
2. **Bit width and overflow.** Token amounts multiplied by seconds need wider encrypted accumulators or carefully proven bounds.
3. **Checkpoint semantics.** Observation periods must be shorter than a draw and finalized correctly; PoolTogether's documentation explicitly discusses historical-accuracy and observation-overwrite constraints.
4. **Withdrawal semantics.** If a saver withdraws before selection, the protocol must decide whether previously accumulated time weight remains eligible. Retaining it permits winning without current principal; erasing it stops being a true time average.
5. **FHE cost.** More encrypted multiplication, addition, checkpoint updates and comparisons occur on routine user actions. These would need new HCU benchmarks rather than being assumed affordable.
6. **Migration.** The existing pools are non-upgradeable. TWAB would require new audited contracts and a new canonical deployment, invalidating the current journey evidence.

For the bounded Sepolia implementation and bounty requirement, those costs did not outweigh the benefit of duration weighting.

## Why fixed padded slots were not selected

A fixed-slot construction assigns every participant a public slot of capacity `S`, then encryptedly treats `wᵢ` positions inside that slot as active. It can make each participant's settlement check more independent, which is attractive at large scale.

However:

- `wᵢ > S` must be capped, split or represented with additional slots;
- each partially filled slot contains inactive positions;
- power-of-two padding may add more inactive positions;
- a random target can land in inactive space, producing no winner; and
- absolute odds become `wᵢ / domainSize`, rather than exactly `wᵢ / Σw` unless another normalization mechanism is added.

No-winner rollover can be a deliberate economic feature. ZamOps instead chose the simpler product promise that a separately funded prize in a valid non-empty draw eventually maps to one of the current encrypted weights.

## Consequences of the decision

### Positive

- Exact and testable `wᵢ/T` probabilities.
- No fixed per-user weight cap or padded no-winner region.
- No offchain randomness or plaintext per-user weight.
- Principal and current-draw odds have a simple, auditable relationship.
- Withdrawals remain possible during every lifecycle state.
- FHE cost is measurable and bounded with an eight-participant batch.
- The random sampler, boundary mapping, statistical distribution, invalid-candidate retry and HCU budgets are covered by tests.

### Negative

- A deposit made shortly before `requestDraw()` receives full weight in that draw.
- Public transaction timing makes the approximate snapshot window observable.
- Selection and next-round synchronization scale linearly and the deployed pool is capped at 64 participants.
- The combined eligible weight is publicly revealed to progress the draw.
- Moving to TWAB or a different selection structure requires a new pool deployment.

## Current mitigations and honest boundary

- Deposits close atomically when `requestDraw()` is mined, so weights cannot change after the snapshot.
- Any account may request a due draw; the keeper does not own the snapshot or selection authority.
- Encrypted rejection sampling prevents modulo bias.
- The participant and batch bounds prevent one transaction from attempting unbounded encrypted work.
- Principal never becomes prize liquidity, so timing strategy can change odds but cannot take another saver's deposit.

There is currently **no minimum holding period and no duration weighting**. The design must not be described as resistant to last-minute deposits.

## Reconsideration triggers

This decision should be revisited if any of the following become product requirements:

- rewards should explicitly favor long-term saving rather than current committed principal;
- empirical usage shows material last-minute liquidity cycling;
- pools must support materially more than 64 participants;
- HCU limits or FHE operation costs change enough to make richer history affordable;
- a production yield source introduces duration-based yield attribution; or
- users accept next-round activation in exchange for simpler timing resistance.

The next design review should benchmark at least three candidates with the same privacy boundary: encrypted TWAB, next-round activation, and a scalable range/tree construction. None should replace the current model without probability proofs, HCU/depth measurements, withdrawal-state tests and an explicit leakage analysis.

## Evidence

- [Draw fairness and accounting](draw-fairness-and-accounting.md)
- [Testing and release evidence](testing-and-release-evidence.md)
- [Canonical Blockscout FHE operation trace](https://eth-sepolia.blockscout.com/tx/0x043053976a6029c381ccabc349ca3b64456d3cd7619707b16872d520b493c718)
- [Zama encrypted randomness](https://docs.zama.org/protocol/solidity-guides/smart-contract/operations/random)
- [Zama HCU model](https://docs.zama.org/protocol/solidity-guides/development-guide/hcu)
- [PoolTogether TWAB design](https://dev.pooltogether.com/protocol/design/twab-controller/)
- [OpenZeppelin ERC-7984 confidential tokens](https://docs.openzeppelin.com/confidential-contracts/token)
