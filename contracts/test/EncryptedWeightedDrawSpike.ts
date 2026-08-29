import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import type {
  EncryptedWeightedDrawHarness,
  EncryptedWeightedDrawSpike,
} from "../typechain-types";

describe("EncryptedWeightedDrawSpike", function () {
  const EXPECTED_SAMPLER_HCU = { global: 1_968_144, depth: 607_000 } as const;
  const EXPECTED_MAX_BATCH_HCU = { global: 4_792_080, depth: 1_709_032 } as const;

  before(function () {
    if (!fhevm.isMock) this.skip();
  });

  async function deployHarness() {
    const [deployer, alice, bob, carol, outsider] = await ethers.getSigners();
    const draw = (await ethers.deployContract(
      "EncryptedWeightedDrawHarness",
    )) as unknown as EncryptedWeightedDrawHarness;
    return { deployer, alice, bob, carol, outsider, draw };
  }

  async function recordWeight(
    draw: EncryptedWeightedDrawSpike,
    signer: HardhatEthersSigner,
    amount: bigint,
  ) {
    const drawAddress = await draw.getAddress();
    const encrypted = await fhevm
      .createEncryptedInput(drawAddress, signer.address)
      .add64(amount)
      .encrypt();

    await draw
      .connect(signer)
      .recordEncryptedWeight(encrypted.handles[0], encrypted.inputProof);
  }

  async function submitPublicDecryption(
    draw: EncryptedWeightedDrawSpike,
    callback: "startSelection" | "finalizeSelection",
    handle: string,
  ) {
    const result = await fhevm.publicDecrypt([handle]);
    const handles = [handle];
    let transaction;
    if (callback === "startSelection") {
      transaction = await draw.startSelection(
        handles,
        result.abiEncodedClearValues,
        result.decryptionProof,
      );
    } else {
      transaction = await draw.finalizeSelection(
        handles,
        result.abiEncodedClearValues,
        result.decryptionProof,
      );
    }
    const receipt = await transaction.wait();
    if (!receipt) throw new Error("Decryption callback transaction was not mined");
    return { result, receipt };
  }

  async function decryptFor(
    draw: EncryptedWeightedDrawSpike,
    signer: HardhatEthersSigner,
    getter: "encryptedWeightOf" | "encryptedWinningsOf",
  ) {
    const handle =
      getter === "encryptedWeightOf"
        ? await draw.encryptedWeightOf(signer.address)
        : await draw.encryptedWinningsOf(signer.address);
    return fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await draw.getAddress(),
      signer,
    );
  }

  async function startHarnessSelection(
    draw: EncryptedWeightedDrawHarness,
    target: bigint,
  ) {
    await draw.configureSample(target, false);
    await draw.requestDraw();
    const totalHandle = await draw.totalWeightHandle();
    await submitPublicDecryption(draw, "startSelection", totalHandle);
  }

  async function processAndFinalize(
    draw: EncryptedWeightedDrawSpike,
  ) {
    while ((await draw.state()) === 2n) {
      await draw.processSelectionBatch(2);
    }
    const resultHandle = await draw.resultHandle();
    await submitPublicDecryption(draw, "finalizeSelection", resultHandle);
  }

  async function runBoundaryCase(target: bigint, expectedWinner: "alice" | "bob" | "carol") {
    const fixture = await deployHarness();
    const { alice, bob, carol, draw } = fixture;
    await recordWeight(draw, alice, 10n);
    await recordWeight(draw, bob, 30n);
    await recordWeight(draw, carol, 60n);

    await startHarnessSelection(draw, target);
    expect(await draw.revealedTotalWeight()).to.equal(100n);
    await processAndFinalize(draw);

    expect(await draw.state()).to.equal(4n);
    const winnings = {
      alice: await decryptFor(draw, alice, "encryptedWinningsOf"),
      bob: await decryptFor(draw, bob, "encryptedWinningsOf"),
      carol: await decryptFor(draw, carol, "encryptedWinningsOf"),
    };
    expect(winnings).to.deep.equal({
      alice: expectedWinner === "alice" ? 1n : 0n,
      bob: expectedWinner === "bob" ? 1n : 0n,
      carol: expectedWinner === "carol" ? 1n : 0n,
    });
  }

  it("keeps weights private while letting each participant decrypt their own value", async function () {
    const { alice, outsider, draw } = await deployHarness();
    await recordWeight(draw, alice, 42n);

    expect(await decryptFor(draw, alice, "encryptedWeightOf")).to.equal(42n);

    const weightHandle = await draw.encryptedWeightOf(alice.address);
    let outsiderCouldDecrypt = true;
    try {
      await fhevm.userDecryptEuint(
        FhevmType.euint64,
        weightHandle,
        await draw.getAddress(),
        outsider,
      );
    } catch {
      outsiderCouldDecrypt = false;
    }
    expect(outsiderCouldDecrypt).to.equal(false);

    let weightWasPublic = true;
    try {
      await fhevm.publicDecrypt([weightHandle]);
    } catch {
      weightWasPublic = false;
    }
    expect(weightWasPublic).to.equal(false);
  });

  it("adds repeat encrypted deposits without duplicating the public participant", async function () {
    const { alice, draw } = await deployHarness();
    await recordWeight(draw, alice, 12n);
    await recordWeight(draw, alice, 30n);

    expect(await draw.participantCount()).to.equal(1n);
    expect(await decryptFor(draw, alice, "encryptedWeightOf")).to.equal(42n);
  });

  it("maps the exact cumulative-weight boundaries to the correct participant", async function () {
    await runBoundaryCase(0n, "alice");
    await runBoundaryCase(9n, "alice");
    await runBoundaryCase(10n, "bob");
    await runBoundaryCase(39n, "bob");
    await runBoundaryCase(40n, "carol");
    await runBoundaryCase(99n, "carol");
  });

  it("does not mutate principal weights while awarding exactly one spike prize", async function () {
    const { alice, bob, carol, draw } = await deployHarness();
    await recordWeight(draw, alice, 10n);
    await recordWeight(draw, bob, 30n);
    await recordWeight(draw, carol, 60n);

    await startHarnessSelection(draw, 40n);
    await processAndFinalize(draw);

    expect(await decryptFor(draw, alice, "encryptedWeightOf")).to.equal(10n);
    expect(await decryptFor(draw, bob, "encryptedWeightOf")).to.equal(30n);
    expect(await decryptFor(draw, carol, "encryptedWeightOf")).to.equal(60n);
  });

  it("locks deposits during a draw and enforces bounded batches", async function () {
    const { alice, bob, draw } = await deployHarness();
    await recordWeight(draw, alice, 10n);
    await draw.configureSample(0n, false);
    await draw.requestDraw();

    const encrypted = await fhevm
      .createEncryptedInput(await draw.getAddress(), bob.address)
      .add64(5n)
      .encrypt();
    await expect(
      draw.connect(bob).recordEncryptedWeight(encrypted.handles[0], encrypted.inputProof),
    ).to.be.revertedWithCustomError(draw, "DrawNotOpen");

    await submitPublicDecryption(draw, "startSelection", await draw.totalWeightHandle());
    await expect(draw.processSelectionBatch(0)).to.be.revertedWithCustomError(draw, "InvalidBatchSize");
    await expect(draw.processSelectionBatch(9)).to.be.revertedWithCustomError(draw, "InvalidBatchSize");
  });

  it("rejects a public-decryption proof for any handle except the frozen total", async function () {
    const { alice, draw } = await deployHarness();
    await recordWeight(draw, alice, 10n);
    await draw.requestDraw();

    const wrongHandle = ethers.id("unrelated encrypted handle");
    await expect(
      draw.startSelection([wrongHandle], "0x", "0x"),
    ).to.be.revertedWithCustomError(draw, "InvalidDecryptionHandle");
  });

  it("retries an all-invalid candidate set without awarding a prize", async function () {
    const { alice, bob, draw } = await deployHarness();
    await recordWeight(draw, alice, 10n);
    await recordWeight(draw, bob, 30n);
    await draw.configureSample(0n, true);
    await draw.requestDraw();
    await submitPublicDecryption(draw, "startSelection", await draw.totalWeightHandle());

    while ((await draw.state()) === 2n) {
      await draw.processSelectionBatch(2);
    }
    expect(await decryptFor(draw, alice, "encryptedWinningsOf")).to.equal(0n);
    expect(await decryptFor(draw, bob, "encryptedWinningsOf")).to.equal(0n);

    // The verified false result starts the next attempt using this now-valid sample.
    await draw.configureSample(10n, false);
    await submitPublicDecryption(draw, "finalizeSelection", await draw.resultHandle());
    expect(await draw.state()).to.equal(2n);
    expect(await draw.retryCount()).to.equal(1n);

    await processAndFinalize(draw);
    expect(await decryptFor(draw, alice, "encryptedWinningsOf")).to.equal(0n);
    expect(await decryptFor(draw, bob, "encryptedWinningsOf")).to.equal(1n);
  });

  it("completes a draw with the production FHE random sampler", async function () {
    const [, alice, bob, carol] = await ethers.getSigners();
    const draw = (await ethers.deployContract(
      "EncryptedWeightedDrawSpike",
    )) as unknown as EncryptedWeightedDrawSpike;
    await recordWeight(draw, alice, 10n);
    await recordWeight(draw, bob, 30n);
    await recordWeight(draw, carol, 60n);
    await draw.requestDraw();
    await submitPublicDecryption(draw, "startSelection", await draw.totalWeightHandle());

    for (let attempt = 0; attempt < 5 && (await draw.state()) !== 4n; ++attempt) {
      while ((await draw.state()) === 2n) {
        await draw.processSelectionBatch(3);
      }
      await submitPublicDecryption(draw, "finalizeSelection", await draw.resultHandle());
    }

    expect(await draw.state()).to.equal(4n);
    const totalWinnings =
      (await decryptFor(draw, alice, "encryptedWinningsOf")) +
      (await decryptFor(draw, bob, "encryptedWinningsOf")) +
      (await decryptFor(draw, carol, "encryptedWinningsOf"));
    expect(totalWinnings).to.equal(1n);
  });

  it("measures the maximum production sampler and selection batch HCU", async function () {
    const signers = await ethers.getSigners();
    const participants = signers.slice(1, 9);
    const draw = (await ethers.deployContract(
      "EncryptedWeightedDrawSpike",
    )) as unknown as EncryptedWeightedDrawSpike;

    for (const participant of participants) {
      await recordWeight(draw, participant, 1n);
    }
    await draw.requestDraw();

    const start = await submitPublicDecryption(
      draw,
      "startSelection",
      await draw.totalWeightHandle(),
    );
    const startHcu = fhevm.computeTransactionHCU(start.receipt);

    const batchTransaction = await draw.processSelectionBatch(8);
    const batchReceipt = await batchTransaction.wait();
    if (!batchReceipt) throw new Error("Selection batch transaction was not mined");
    const batchHcu = fhevm.computeTransactionHCU(batchReceipt);

    // These are regression gates for the pinned FHEVM dependencies. If an
    // intentional dependency or algorithm change moves them, review the
    // Blockscout operation trace before updating the expected values.
    expect(startHcu.globalHCU).to.equal(EXPECTED_SAMPLER_HCU.global);
    expect(startHcu.maxHCUDepth).to.equal(EXPECTED_SAMPLER_HCU.depth);
    expect(batchHcu.globalHCU).to.equal(EXPECTED_MAX_BATCH_HCU.global);
    expect(batchHcu.maxHCUDepth).to.equal(EXPECTED_MAX_BATCH_HCU.depth);

    if (process.env.REPORT_HCU === "true") {
      console.info("weighted draw HCU", {
        sampler: {
          gasUsed: start.receipt.gasUsed.toString(),
          globalHCU: startHcu.globalHCU,
          maxHCUDepth: startHcu.maxHCUDepth,
        },
        maxBatch: {
          gasUsed: batchReceipt.gasUsed.toString(),
          globalHCU: batchHcu.globalHCU,
          maxHCUDepth: batchHcu.maxHCUDepth,
        },
      });
    }
  });
});
