const User = require("../models/User");
const Transaction = require("../models/Transaction");
let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  Notification = null;
}

/**
 * Executes an instant, idempotent automated refund to a user's wallet
 * @param {Object} params - Refund parameters
 * @param {String} params.userId - Beneficiary User ID
 * @param {Number} params.amount - Amount to refund
 * @param {String} params.transactionId - Transaction ID or Reference
 * @param {String} params.service - Service type (DATA, AIRTIME, etc.)
 * @param {String} params.recipient - Beneficiary phone or meter number
 * @param {String} params.reason - Failure reason from Gateway API
 */
exports.processAutoRefund = async ({
  userId,
  amount,
  transactionId,
  service = "VTU Service",
  recipient = "",
  reason = "Automated reversal due to provider failure",
}) => {
  try {
    const refundAmount = Number(amount || 0);
    if (!userId || refundAmount <= 0) {
      return { success: false, message: "Invalid user or refund amount." };
    }

    // 1. Check if the original transaction is already refunded to prevent duplicates
    const existingTx = await Transaction.findOne({
      $or: [{ reference: transactionId }, { transactionId }],
    });

    if (existingTx && (existingTx.status === "refunded" || existingTx.isRefunded)) {
      return { success: true, message: "Transaction already refunded.", alreadyRefunded: true };
    }

    // 2. Atomically increment wallet balance to guarantee math safety
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: refundAmount,
          balance: refundAmount,
        },
      },
      { new: true }
    );

    if (!updatedUser) {
      return { success: false, message: "Beneficiary account not found." };
    }

    const currentBalance = Number(updatedUser.walletBalance ?? updatedUser.balance ?? 0);
    const previousBalance = currentBalance - refundAmount;

    // 3. Mark original transaction as failed / refunded
    if (existingTx) {
      existingTx.status = "refunded";
      existingTx.isRefunded = true;
      existingTx.refundReason = reason;
      existingTx.refundedAt = new Date();
      await existingTx.save();
    }

    // 4. Create explicit REFUND record in unified ledger
    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const refundTransaction = await Transaction.create({
      user: updatedUser._id,
      userId: updatedUser._id,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: ${service.toUpperCase()}`,
      amount: refundAmount,
      previousBalance,
      newBalance: currentBalance,
      recipient: recipient || updatedUser.phone,
      phoneNumber: recipient || updatedUser.phone,
      status: "success",
      description: `Auto-Refund of ₦${refundAmount.toLocaleString()} for failed ${service.toUpperCase()} (${reason})`,
      details: {
        originalTransactionId: transactionId,
        failureReason: reason,
        gatewayError: true,
      },
      isRefunded: false,
    });

    // 5. Send In-App & Push Notification
    const notifTitle = "Instant Refund Credited 💰";
    const notifMessage = `Your wallet has been refunded with ₦${refundAmount.toLocaleString()} because your ${service.toUpperCase()} request to ${recipient || "destination"} could not be delivered. Reason: ${reason}`;

    if (Notification) {
      await Notification.create({
        recipient: updatedUser._id,
        user: updatedUser._id,
        userId: updatedUser._id,
        title: notifTitle,
        message: notifMessage,
        category: "REFUND",
        type: "refund",
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        isRead: false,
        read: false,
        createdAt: new Date(),
      }).catch(() => {});
    }

    console.log(`[AUTO-REFUND APPLIED]: ₦${refundAmount} credited to ${updatedUser.phone || updatedUser.email} (Ref: ${refundRef})`);

    return {
      success: true,
      newBalance: currentBalance,
      refundReference: refundRef,
    };
  } catch (error) {
    console.error("Auto Refund Processing Error:", error);
    return { success: false, message: error.message };
  }
};