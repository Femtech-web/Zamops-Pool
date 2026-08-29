import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import type {
  ConfidentialPrizePoolHarness,
  MockConfidentialToken,
  ZamOpsPoolFaucet,
} from "../typechain-types";

describe("ConfidentialPrizePool", function () {
  const OPERATOR_UNTIL = 281_474_976_710_655n;
  const EXPECTED_LIFECYCLE_HCU = {
    deposit: { global: 1_435_192, depth: 732_032 },
    prizeFunding: { global: 748_032, depth: 369_000 },
    selectionBatch: { global: 1_198_068, depth: 737_000 },
    nextDrawSync: { global: 324_000, depth: 324_000 },
    claim: { global: 586_064, depth: 369_000 },
    withdrawal: { global: 1_273_032, depth: 570_000 },
  } as const;

  before(function () {
    if (!fhevm.isMock) this.skip();
  });

  async function deployFixture() {
    const [deployer, alice, bob, funder, relayer, outsider] = await ethers.getSigners();
    const token = (await ethers.deployContract("MockConfidentialToken")) as unknown as MockConfidentialToken;
    const registry = await ethers.deployContract("MockConfidentialTokenRegistry");
    await registry.setValid(await token.getAddress(), true);
    const pool = (await ethers.deployContract("ConfidentialPrizePoolHarness", [
      await registry.getAddress(),
      await token.getAddress(),
    ])) as unknown as ConfidentialPrizePoolHarness;
    return { deployer, alice, bob, funder, relayer, outsider, token, registry, pool };
  }

  async function mintAndApprove(
    token: MockConfidentialToken,
    pool: ConfidentialPrizePoolHarness,
    participant: HardhatEthersSigner,
    amount: bigint,
  ) {
    await token.mint(participant.address, amount);
    await token.connect(participant).setOperator(await pool.getAddress(), OPERATOR_UNTIL);
  }

  async function poolInput(pool: ConfidentialPrizePoolHarness, signer: HardhatEthersSigner, amount: bigint) {
    return fhevm
      .createEncryptedInput(await pool.getAddress(), signer.address)
      .add64(amount)
      .encrypt();
  }

  async function deposit(
    _token: MockConfidentialToken,
    pool: ConfidentialPrizePoolHarness,
    signer: HardhatEthersSigner,
    amount: bigint,
  ) {
    const encrypted = await poolInput(pool, signer, amount);
    await pool.connect(signer).deposit(encrypted.handles[0], encrypted.inputProof);
  }

  async function fundPrize(
    _token: MockConfidentialToken,
    pool: ConfidentialPrizePoolHarness,
    signer: HardhatEthersSigner,
    amount: bigint,
  ) {
    const encrypted = await poolInput(pool, signer, amount);
    await pool.connect(signer).fundPrize(encrypted.handles[0], encrypted.inputProof);
  }

  async function withdraw(pool: ConfidentialPrizePoolHarness, signer: HardhatEthersSigner, amount: bigint) {
    const encrypted = await poolInput(pool, signer, amount);
    await pool.connect(signer).withdraw(encrypted.handles[0], encrypted.inputProof);
  }

  async function decryptPoolValue(
    pool: ConfidentialPrizePoolHarness,
    signer: HardhatEthersSigner,
    field: "principal" | "winnings",
  ) {
    const handle =
      field === "principal"
        ? await pool.encryptedPrincipalOf(signer.address)
        : await pool.encryptedWinningsOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, await pool.getAddress(), signer);
  }

  async function decryptTokenBalance(token: MockConfidentialToken, signer: HardhatEthersSigner) {
    const handle = await token.confidentialBalanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, await token.getAddress(), signer);
  }

  async function submitPublicDecryption(
    pool: ConfidentialPrizePoolHarness,
    phase: "total" | "result",
  ) {
    const handle = phase === "total" ? await pool.totalWeightHandle() : await pool.resultHandle();
    const result = await fhevm.publicDecrypt([handle]);
    if (phase === "total") {
      await pool.startSelection([handle], result.abiEncodedClearValues, result.decryptionProof);
    } else {
      await pool.finalizeSelection([handle], result.abiEncodedClearValues, result.decryptionProof);
    }
  }

  async function runDraw(pool: ConfidentialPrizePoolHarness, target: bigint) {
    await pool.configureSample(target, false);
    await pool.requestDraw();
    await submitPublicDecryption(pool, "total");
    while ((await pool.state()) === 2n) await pool.processSelectionBatch(8);
    await submitPublicDecryption(pool, "result");
  }

  async function finishSync(pool: ConfidentialPrizePoolHarness) {
    while ((await pool.state()) === 4n) await pool.processNextDrawSyncBatch(8);
  }

  it("custodies the actual ERC-7984 transfer and preserves no-loss withdrawals", async function () {
    const { alice, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 100n);
    await deposit(token, pool, alice, 80n);

    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(80n);
    expect(await decryptTokenBalance(token, alice)).to.equal(20n);

    await withdraw(pool, alice, 30n);
    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(50n);
    expect(await decryptTokenBalance(token, alice)).to.equal(50n);

    // Over-requesting is confidentially capped to the caller's principal.
    await withdraw(pool, alice, 500n);
    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(0n);
    expect(await decryptTokenBalance(token, alice)).to.equal(100n);
  });

  it("emits user-decryptable handles for exact accepted deposits and withdrawals", async function () {
    const { alice, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 25n);

    const depositInput = await poolInput(pool, alice, 25n);
    const depositReceipt = await (await pool.connect(alice).deposit(depositInput.handles[0], depositInput.inputProof)).wait();
    const depositEvent = depositReceipt!.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((event) => event?.name === "EncryptedDeposit");
    expect(depositEvent).to.not.equal(undefined);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, depositEvent!.args.encryptedAmount, await pool.getAddress(), alice)).to.equal(25n);

    const withdrawInput = await poolInput(pool, alice, 100n);
    const withdrawReceipt = await (await pool.connect(alice).withdraw(withdrawInput.handles[0], withdrawInput.inputProof)).wait();
    const withdrawalEvent = withdrawReceipt!.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((event) => event?.name === "EncryptedWithdrawal");
    expect(withdrawalEvent).to.not.equal(undefined);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, withdrawalEvent!.args.encryptedAmount, await pool.getAddress(), alice)).to.equal(25n);
  });

  it("does not credit a requested deposit when the token transfers zero", async function () {
    const { alice, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 25n);
    await deposit(token, pool, alice, 100n);

    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(0n);
    expect(await decryptTokenBalance(token, alice)).to.equal(25n);
  });

  it("rejects an encrypted input proof scoped to another wallet", async function () {
    const { alice, bob, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, bob, 25n);
    const aliceScopedInput = await poolInput(pool, alice, 10n);

    await expect(
      pool.connect(bob).deposit(aliceScopedInput.handles[0], aliceScopedInput.inputProof),
    ).to.be.reverted;
    expect(await decryptTokenBalance(token, bob)).to.equal(25n);
  });

  it("confidentially caps deposits before the aggregate can overflow", async function () {
    const { alice, bob, token, pool } = await deployFixture();
    const maximum = 1n << 63n;
    await mintAndApprove(token, pool, alice, maximum);
    await mintAndApprove(token, pool, bob, 10n);
    await deposit(token, pool, alice, maximum);
    await deposit(token, pool, bob, 10n);

    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(maximum);
    expect(await decryptPoolValue(pool, bob, "principal")).to.equal(0n);
    expect(await decryptTokenBalance(token, bob)).to.equal(10n);

    await pool.requestDraw();
    const totalHandle = (await pool.totalWeightHandle()) as `0x${string}`;
    const total = await fhevm.publicDecrypt([totalHandle]);
    expect(total.clearValues[totalHandle]).to.equal(maximum);
  });

  it("keeps principal separate while awarding and claiming the funded prize", async function () {
    const { alice, bob, funder, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 100n);
    await mintAndApprove(token, pool, bob, 100n);
    await mintAndApprove(token, pool, funder, 100n);
    await deposit(token, pool, alice, 10n);
    await deposit(token, pool, bob, 30n);
    await fundPrize(token, pool, funder, 50n);

    await runDraw(pool, 10n);
    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(10n);
    expect(await decryptPoolValue(pool, bob, "principal")).to.equal(30n);
    expect(await decryptPoolValue(pool, alice, "winnings")).to.equal(0n);
    expect(await decryptPoolValue(pool, bob, "winnings")).to.equal(50n);

    await pool.connect(bob).claim();
    expect(await decryptPoolValue(pool, bob, "winnings")).to.equal(0n);
    expect(await decryptTokenBalance(token, bob)).to.equal(120n);
    expect(await decryptPoolValue(pool, bob, "principal")).to.equal(30n);

    await withdraw(pool, alice, 10n);
    await withdraw(pool, bob, 30n);
    expect(await decryptTokenBalance(token, alice)).to.equal(100n);
    expect(await decryptTokenBalance(token, bob)).to.equal(150n);
    expect(await decryptTokenBalance(token, funder)).to.equal(50n);
  });

  it("rejects a forged public-decryption result for the expected handle", async function () {
    const { alice, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 20n);
    await deposit(token, pool, alice, 10n);
    await pool.requestDraw();

    const expectedHandle = await pool.totalWeightHandle();
    const forgedCleartext = ethers.AbiCoder.defaultAbiCoder().encode(["uint64"], [10n]);
    await expect(
      pool.startSelection([expectedHandle], forgedCleartext, "0x1234"),
    ).to.be.reverted;
    expect(await pool.state()).to.equal(1n);
  });

  it("measures HCU across the confidential pool lifecycle", async function () {
    const { alice, bob, funder, token, pool } = await deployFixture();
    for (const saver of [alice, bob]) await mintAndApprove(token, pool, saver, 100n);
    await mintAndApprove(token, pool, funder, 100n);

    async function receiptOf(
      transaction: Promise<ContractTransactionResponse>,
    ): Promise<TransactionReceipt> {
      const receipt = await (await transaction).wait();
      if (!receipt) throw new Error("HCU measurement transaction was not mined");
      return receipt;
    }

    const aliceInput = await poolInput(pool, alice, 10n);
    const depositReceipt = await receiptOf(
      pool.connect(alice).deposit(aliceInput.handles[0], aliceInput.inputProof),
    );
    const bobInput = await poolInput(pool, bob, 30n);
    await pool.connect(bob).deposit(bobInput.handles[0], bobInput.inputProof);
    const prizeInput = await poolInput(pool, funder, 50n);
    const fundingReceipt = await receiptOf(
      pool.connect(funder).fundPrize(prizeInput.handles[0], prizeInput.inputProof),
    );

    await pool.configureSample(10n, false);
    await pool.requestDraw();
    await submitPublicDecryption(pool, "total");
    const selectionReceipt = await receiptOf(pool.processSelectionBatch(8));
    await submitPublicDecryption(pool, "result");
    const syncReceipt = await receiptOf(pool.processNextDrawSyncBatch(8));
    const claimReceipt = await receiptOf(pool.connect(bob).claim());
    const withdrawalInput = await poolInput(pool, alice, 10n);
    const withdrawalReceipt = await receiptOf(
      pool.connect(alice).withdraw(withdrawalInput.handles[0], withdrawalInput.inputProof),
    );

    const measurements = {
      deposit: fhevm.computeTransactionHCU(depositReceipt),
      prizeFunding: fhevm.computeTransactionHCU(fundingReceipt),
      selectionBatch: fhevm.computeTransactionHCU(selectionReceipt),
      nextDrawSync: fhevm.computeTransactionHCU(syncReceipt),
      claim: fhevm.computeTransactionHCU(claimReceipt),
      withdrawal: fhevm.computeTransactionHCU(withdrawalReceipt),
    };

    for (const [operation, measurement] of Object.entries(measurements)) {
      const expected = EXPECTED_LIFECYCLE_HCU[operation as keyof typeof EXPECTED_LIFECYCLE_HCU];
      expect(measurement.globalHCU).to.equal(expected.global);
      expect(measurement.maxHCUDepth).to.equal(expected.depth);
    }

    if (process.env.REPORT_HCU === "true") {
      console.info("confidential pool lifecycle HCU", Object.fromEntries(
        Object.entries(measurements).map(([operation, measurement]) => [operation, {
          globalHCU: measurement.globalHCU,
          maxHCUDepth: measurement.maxHCUDepth,
        }]),
      ));
    }
  });

  it("allows withdrawal during a draw while keeping current odds frozen and resyncing the next draw", async function () {
    const { alice, bob, funder, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 20n);
    await mintAndApprove(token, pool, bob, 40n);
    await mintAndApprove(token, pool, funder, 10n);
    await deposit(token, pool, alice, 10n);
    await deposit(token, pool, bob, 30n);
    await fundPrize(token, pool, funder, 10n);

    await pool.configureSample(0n, false);
    await pool.requestDraw();
    await submitPublicDecryption(pool, "total");
    await withdraw(pool, alice, 10n);
    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(0n);

    await pool.processSelectionBatch(8);
    await submitPublicDecryption(pool, "result");
    expect(await decryptPoolValue(pool, alice, "winnings")).to.equal(10n);

    await finishSync(pool);
    await pool.requestDraw();
    const nextTotal = await fhevm.publicDecrypt([await pool.totalWeightHandle()]);
    const totalHandle = (await pool.totalWeightHandle()) as `0x${string}`;
    expect(nextTotal.clearValues[totalHandle]).to.equal(30n);
  });

  it("blocks deposits during a draw but permits next-draw prize funding", async function () {
    const { alice, bob, funder, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 20n);
    await mintAndApprove(token, pool, bob, 20n);
    await mintAndApprove(token, pool, funder, 20n);
    await deposit(token, pool, alice, 10n);
    await pool.requestDraw();

    const bobDeposit = await poolInput(pool, bob, 10n);
    await expect(pool.connect(bob).deposit(bobDeposit.handles[0], bobDeposit.inputProof))
      .to.be.revertedWithCustomError(pool, "DepositsClosed");
    await fundPrize(token, pool, funder, 10n);
  });

  it("stops new deposits after registry revocation without trapping principal", async function () {
    const { alice, bob, token, registry, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 20n);
    await mintAndApprove(token, pool, bob, 20n);
    await deposit(token, pool, alice, 10n);
    await registry.setValid(await token.getAddress(), false);

    const bobDeposit = await poolInput(pool, bob, 10n);
    await expect(pool.connect(bob).deposit(bobDeposit.handles[0], bobDeposit.inputProof))
      .to.be.revertedWithCustomError(pool, "AssetNotRegistryValid");

    await withdraw(pool, alice, 10n);
    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(0n);
  });

  it("does not grant another wallet permission to decrypt a participant's principal", async function () {
    const { alice, outsider, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 20n);
    await deposit(token, pool, alice, 10n);
    const handle = await pool.encryptedPrincipalOf(alice.address);

    let rejected = false;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint64, handle, await pool.getAddress(), outsider);
    } catch {
      rejected = true;
    }
    expect(rejected).to.equal(true);
  });

  it("enforces the configured draw interval", async function () {
    const { alice, token, registry } = await deployFixture();
    const timedPool = (await ethers.deployContract("ConfidentialPrizePool", [
      await registry.getAddress(),
      await token.getAddress(),
      3600,
    ])) as unknown as ConfidentialPrizePoolHarness;
    await mintAndApprove(token, timedPool, alice, 20n);
    await deposit(token, timedPool, alice, 10n);

    await expect(timedPool.requestDraw()).to.be.revertedWithCustomError(timedPool, "DrawTooEarly");
  });

  it("makes repeated zero-winning claims safe and keeps principal intact", async function () {
    const { alice, token, pool } = await deployFixture();
    await mintAndApprove(token, pool, alice, 20n);
    await deposit(token, pool, alice, 10n);

    await pool.connect(alice).claim();
    await pool.connect(alice).claim();
    expect(await decryptPoolValue(pool, alice, "principal")).to.equal(10n);
    expect(await decryptPoolValue(pool, alice, "winnings")).to.equal(0n);
  });

  it("creates one independent pool per registry-valid asset", async function () {
    const { token, registry } = await deployFixture();
    const factory = await ethers.deployContract("ZamOpsPoolFactory", [await registry.getAddress(), 3600]);

    await expect(factory.createPool(await token.getAddress())).to.emit(factory, "PoolCreated");
    const poolAddress = await factory.poolByAsset(await token.getAddress());
    expect(poolAddress).not.to.equal(ethers.ZeroAddress);
    expect(await factory.poolCount()).to.equal(1n);
    await expect(factory.createPool(await token.getAddress()))
      .to.be.revertedWithCustomError(factory, "PoolAlreadyExists");
  });
});

describe("weighted draw statistical model", function () {
  it("converges to the configured 10/30/60 deposit weights", function () {
    const weights = [10, 30, 60];
    const observed = [0, 0, 0];
    let state = 0x6d2b79f5;

    for (let sample = 0; sample < 100_000; ++sample) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const target = (state >>> 0) % 100;
      let cumulative = 0;
      for (let index = 0; index < weights.length; ++index) {
        cumulative += weights[index];
        if (target < cumulative) {
          observed[index] += 1;
          break;
        }
      }
    }

    expect(observed[0] / 100_000).to.be.closeTo(0.1, 0.005);
    expect(observed[1] / 100_000).to.be.closeTo(0.3, 0.005);
    expect(observed[2] / 100_000).to.be.closeTo(0.6, 0.005);
  });
});

describe("ZamOpsPoolFaucet", function () {
  it("supports direct and gas-sponsored public-mint claims with per-token cooldowns", async function () {
    const [owner, alice, bob, relayer] = await ethers.getSigners();
    const token = await ethers.deployContract("MockFaucetToken", [true]);
    const faucet = (await ethers.deployContract("ZamOpsPoolFaucet", [
      owner.address,
    ])) as unknown as ZamOpsPoolFaucet;
    await faucet.configureToken(await token.getAddress(), 1_000n, true);
    await faucet.configureRelayer(relayer.address, true);

    await faucet.connect(alice).claim(await token.getAddress());
    expect(await token.balanceOf(alice.address)).to.equal(1_000n);
    await expect(faucet.connect(alice).claim(await token.getAddress()))
      .to.be.revertedWithCustomError(faucet, "FaucetClaimOnCooldown");

    await faucet.connect(relayer).claimFor(bob.address, await token.getAddress());
    expect(await token.balanceOf(bob.address)).to.equal(1_000n);
  });

  it("uses funded inventory for restricted-mint assets and never pretends minting succeeded", async function () {
    const [owner, alice] = await ethers.getSigners();
    const token = await ethers.deployContract("MockFaucetToken", [false]);
    const faucet = (await ethers.deployContract("ZamOpsPoolFaucet", [
      owner.address,
    ])) as unknown as ZamOpsPoolFaucet;
    await faucet.configureToken(await token.getAddress(), 500n, true);

    await expect(faucet.connect(alice).claim(await token.getAddress()))
      .to.be.revertedWithCustomError(faucet, "FaucetInventoryTooLow");

    await token.seed(await faucet.getAddress(), 500n);
    await faucet.connect(alice).claim(await token.getAddress());
    expect(await token.balanceOf(alice.address)).to.equal(500n);
  });
});
