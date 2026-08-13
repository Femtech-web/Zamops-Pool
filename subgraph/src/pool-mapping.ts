import { BigInt, Bytes, dataSource, ethereum } from "@graphprotocol/graph-ts";
import {
  ConfidentialPrizePool as PoolContract,
  DrawCancelledEmpty,
  DrawCompleted,
  EncryptedDeposit,
  EncryptedPrizeClaimed,
  EncryptedPrizeFunded,
  EncryptedWithdrawal,
  PoolReopened,
  SelectionStarted,
  TotalDecryptionRequested,
} from "../generated/templates/ConfidentialPrizePool/ConfidentialPrizePool";
import { PoolActivity, PoolStatus } from "../generated/schema";

export function handleEncryptedDeposit(event: EncryptedDeposit): void {
  saveFinancial(event, "DEPOSIT", event.params.participant, event.params.encryptedAmount);
}

export function handleEncryptedWithdrawal(event: EncryptedWithdrawal): void {
  saveFinancial(event, "WITHDRAWAL", event.params.participant, event.params.encryptedAmount);
}

export function handleEncryptedPrizeFunded(event: EncryptedPrizeFunded): void {
  saveFinancial(event, "PRIZE_FUNDED", event.params.funder, event.params.encryptedAmount);
  const status = loadStatus(event);
  const lifecycle = PoolContract.bind(event.address).try_state();
  if (!lifecycle.reverted && lifecycle.value == 0) status.currentPrizeFunded = true;
  else status.nextPrizeFunded = true;
  saveStatus(status, event);
}

export function handleEncryptedPrizeClaimed(event: EncryptedPrizeClaimed): void {
  saveFinancial(event, "PRIZE_CLAIMED", event.params.participant, event.params.encryptedAmount);
}

export function handleDrawCompleted(event: DrawCompleted): void {
  saveDraw(event, "DRAW_COMPLETED", event.params.drawId);
  const status = loadStatus(event);
  status.phase = "SYNCING";
  saveStatus(status, event);
}

export function handleDrawCancelledEmpty(event: DrawCancelledEmpty): void {
  saveDraw(event, "DRAW_CANCELLED_EMPTY", event.params.drawId);
  const status = loadStatus(event);
  status.phase = "SYNCING";
  status.nextPrizeFunded = status.nextPrizeFunded || status.drawHadFundedPrize;
  status.drawHadFundedPrize = false;
  saveStatus(status, event);
}

export function handlePoolReopened(event: PoolReopened): void {
  saveDraw(event, "POOL_REOPENED", event.params.drawId);
  const status = loadStatus(event);
  status.phase = "OPEN";
  status.drawId = event.params.drawId;
  status.currentPrizeFunded = status.nextPrizeFunded;
  status.nextPrizeFunded = false;
  status.drawHadFundedPrize = false;
  status.revealedTotalWeight = null;
  saveStatus(status, event);
}

export function handleTotalDecryptionRequested(event: TotalDecryptionRequested): void {
  const status = loadStatus(event);
  status.phase = "DRAWING";
  status.drawId = event.params.drawId;
  status.drawHadFundedPrize = status.currentPrizeFunded;
  status.currentPrizeFunded = false;
  status.revealedTotalWeight = null;
  saveStatus(status, event);
}

export function handleSelectionStarted(event: SelectionStarted): void {
  const status = loadStatus(event);
  status.revealedTotalWeight = event.params.revealedTotalWeight;
  saveStatus(status, event);
}

function saveFinancial(event: ethereum.Event, kind: string, account: Bytes, amount: Bytes): void {
  const entity = baseActivity(event, kind);
  entity.account = account;
  entity.encryptedAmount = amount;
  entity.save();
}

function saveDraw(event: ethereum.Event, kind: string, drawId: BigInt): void {
  const entity = baseActivity(event, kind);
  entity.account = event.transaction.from;
  entity.drawId = drawId;
  entity.save();
}

function baseActivity(event: ethereum.Event, kind: string): PoolActivity {
  const entity = new PoolActivity(event.transaction.hash.toHexString() + "-" + event.logIndex.toString());
  entity.chainId = 11155111;
  entity.pool = event.address;
  entity.asset = dataSource.context().getBytes("asset");
  entity.type = kind;
  entity.transactionHash = event.transaction.hash;
  entity.logIndex = event.logIndex;
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  return entity;
}

function loadStatus(event: ethereum.Event): PoolStatus {
  const id = event.address.toHexString();
  const existing = PoolStatus.load(id);
  if (existing != null) return existing;
  const status = new PoolStatus(id);
  status.chainId = 11155111;
  status.pool = event.address;
  status.asset = dataSource.context().getBytes("asset");
  status.phase = "OPEN";
  status.currentPrizeFunded = false;
  status.nextPrizeFunded = false;
  status.drawHadFundedPrize = false;
  status.drawId = BigInt.fromI32(1);
  status.updatedAt = event.block.timestamp;
  return status;
}

function saveStatus(status: PoolStatus, event: ethereum.Event): void {
  status.updatedAt = event.block.timestamp;
  status.save();
}
