import { NETWORK, petFromRef, tx, type TxRequest } from "@/lib/chain";
import type { Approval } from "./brainApi";

/** The one transaction this approval allows, or null when the record is not usable. */
export function buildApprovalTx(a: Approval): TxRequest | null {
  if (a.network !== NETWORK) return null;
  const amount = a.amount_yocto ? BigInt(a.amount_yocto) : null;
  switch (a.kind) {
    case "send":
      return amount && amount > 0n ? tx.transfer(a.receiver_id, amount) : null;
    case "stake": {
      const pool = a.validator ?? a.receiver_id;
      return amount && amount > 0n ? tx.validatorStake(pool, amount) : null;
    }
    case "transfer_pet": {
      const pet = a.pet_ref ? petFromRef(a.pet_ref) : null;
      const tokenId = a.token_id ?? pet?.tokenId;
      return pet && tokenId ? tx.nftTransfer(pet.contract, a.receiver_id, tokenId) : null;
    }
  }
}
