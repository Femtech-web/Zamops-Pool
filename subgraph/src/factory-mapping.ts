import { DataSourceContext } from "@graphprotocol/graph-ts";
import { PoolCreated } from "../generated/ZamOpsPoolFactory/ZamOpsPoolFactory";
import { BigInt } from "@graphprotocol/graph-ts";
import { Pool, PoolStatus } from "../generated/schema";
import { ConfidentialPrizePool as PoolTemplate } from "../generated/templates";

export function handlePoolCreated(event: PoolCreated): void {
  const entity = new Pool(event.params.pool.toHexString());
  entity.chainId = 11155111;
  entity.factory = event.address;
  entity.asset = event.params.confidentialToken;
  entity.pool = event.params.pool;
  entity.transactionHash = event.transaction.hash;
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.save();

  const status = new PoolStatus(event.params.pool.toHexString());
  status.chainId = 11155111;
  status.pool = event.params.pool;
  status.asset = event.params.confidentialToken;
  status.phase = "OPEN";
  status.currentPrizeFunded = false;
  status.nextPrizeFunded = false;
  status.drawHadFundedPrize = false;
  status.drawId = BigInt.fromI32(1);
  status.updatedAt = event.block.timestamp;
  status.save();

  const context = new DataSourceContext();
  context.setBytes("asset", event.params.confidentialToken);
  PoolTemplate.createWithContext(event.params.pool, context);
}
