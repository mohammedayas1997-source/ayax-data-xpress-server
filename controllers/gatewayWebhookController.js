const User = require("../models/User");
const Transaction = require("../models/Transaction");

// Dynamic Notification Import
let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  Notification = null;
}

const sendRefundNotification = async (userId, amount, serviceName, reason) => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title: "Wallet Auto-Refund Credited 💰",
        message: `₦${Number(amount).toLocaleString()} has been refunded back to your wallet for failed ${serviceName}. Reason: ${reason}`,
        category: "REFUND",
        date: new Date(),
        createdAt: new Date(),
        isRead: false,
      });
      if (user.notifications.length > 100) {
        user.notifications = user.notifications.slice(0, 100);
      }
      await user.save({ validateBeforeSave: false });
    }

    if (Notification) {
      await Notification.create({
        recipient: userId,
        user: userId,
        userId: userId,
        title: "Wallet Auto-Refund Credited 💰",
        message: `₦${Number(amount).toLocaleString()} has been refunded back to your wallet for failed ${serviceName}. Reason: ${reason}`,
        category: "REFUND",
        type: "refund",
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        isRead: false,
        createdAt: new Date(),
      }).catch(() => {});
    }
  } catch (error) {
    console.error("Refund Notification Error:", error.message);
  }
};

/**
 * @desc    Karɓar rahoton asali daga Ayax Gateway / SIMHost idan Transaction ya fāɗi a waya
 * @route   POST /api/v1/gateway/webhook (ko /api/v1/webhooks/gateway)
 * @access  Public (Gateway Server Callback)
 */
exports.handleGatewayWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    const reference = payload.reference || payload.orderId || payload.ref_id || payload.transaction_id;
    const rawStatus = String(payload.status || payload.code || "").toLowerCase();
    const reason = payload.reason || payload.message || payload.error || "Gateway Delivery Failed";

    if (!reference) {
      return res.status(400).json({ success: false, message: "Transaction reference is missing." });
    }

    // 1. Nemo ainihin Transaction ɗin a Database
    const transaction = await Transaction.findOne({
      $or: [{ reference }, { transactionId: reference }, { apiReference: reference }],
    });

    if (!transaction) {
      return res.status(200).json({ success: false, message: "Transaction record not found in system." });
    }

    // 2. Idan aikin ya riga ya zama 'refunded' ko 'success', a dakatar don gujewa refund sau biyu
    if (transaction.status === "refunded" || transaction.isRefunded === true) {
      return res.status(200).json({ success: true, message: "Transaction was already refunded." });
    }

    // 3. Duba idan Gateway ya bada rahoton nasara (SUCCESS)
    if (rawStatus === "success" || rawStatus === "successful" || rawStatus === "200") {
      transaction.status = "success";
      transaction.operatorRef = payload.operator_ref || payload.token || transaction.operatorRef;
      await transaction.save();
      return res.status(200).json({ success: true, message: "Transaction updated to success." });
    }

    // 4. Idan aikin ya fāɗi (FAILED / REJECTED) -> YI AUTO-REFUND ZUWA WALLET
    if (
      rawStatus === "failed" ||
      rawStatus === "failure" ||
      rawStatus === "rejected" ||
      rawStatus === "cancelled"
    ) {
      const refundAmt = Number(transaction.amount || 0);
      const targetUserId = transaction.user || transaction.userId;

      const user = await User.findById(targetUserId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User account not found for refund." });
      }

      const prevBal = Number(user.walletBalance ?? user.balance ?? 0);
      const newBal = Number((prevBal + refundAmt).toFixed(2));

      // A. Mayar da kuɗin cikin wallet ta hanyar Atomic Increment
      await User.findByIdAndUpdate(
        user._id,
        {
          $inc: {
            walletBalance: refundAmt,
            balance: refundAmt,
          },
        },
        { new: true }
      );

      // B. Sabunta Transaction ɗin da ya fāɗi
      transaction.status = "refunded";
      transaction.isRefunded = true;
      transaction.refundReason = reason;
      transaction.refundedAt = new Date();
      transaction.details = `Delivery Failed (${reason}) - Refunded ₦${refundAmt}`;
      await transaction.save();

      // C. Ƙirƙirar sabon record na REFUND a History
      const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      await Transaction.create({
        user: user._id,
        userId: user._id,
        transactionId: `TXN-REF-${Date.now()}`,
        reference: refundRef,
        type: "refund",
        category: "WALLET",
        service: `Auto-Refund: ${String(transaction.service || transaction.type).toUpperCase()}`,
        amount: refundAmt,
        oldBalance: prevBal,
        newBalance: newBal,
        previousBalance: prevBal,
        recipient: transaction.recipient || transaction.phoneNumber || user.phone,
        phoneNumber: transaction.phoneNumber || user.phone,
        status: "success",
        description: `Auto-Refund of ₦${refundAmt.toLocaleString()} for failed ${transaction.service || transaction.type} (${reason})`,
        details: {
          originalReference: reference,
          failureReason: reason,
        },
      });

      // D. Tura sanarwar credit
      await sendRefundNotification(user._id, refundAmt, transaction.service || transaction.type, reason);

      console.log(`✅ [AUTO-REFUND EXECUTED]: ₦${refundAmt} credited to ${user.phone || user.email} for failed Ref: ${reference}`);

      return res.status(200).json({
        success: true,
        message: `Transaction failed at gateway. ₦${refundAmt} auto-refunded to wallet.`,
        refundedAmount: refundAmt,
        newBalance: newBal,
      });
    }

    return res.status(200).json({ success: true, message: "Webhook acknowledged." });
  } catch (error) {
    console.error("Gateway Webhook Refund Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};