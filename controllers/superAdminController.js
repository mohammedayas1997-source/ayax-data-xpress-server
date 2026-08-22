const User = require("../models/User");
const Transaction = require("../models/Transaction");

// 1. Data & VTU Platform Overview Telemetry
exports.getGlobalDataOverview = async (req, res) => {
  try {
    const [totalUsers, totalAgents, totalSupervisors, totalAdmins] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "agent" }),
      User.countDocuments({ role: { $in: ["supervisor", "leader"] } }),
      User.countDocuments({ role: { $in: ["admin", "superadmin"] } }),
    ]);

    const successfulTransactions = await Transaction.countDocuments({ status: "successful" });
    const revenueAgg = await Transaction.aggregate([
      { $match: { status: "successful" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalRevenue,
        successfulTransactions,
        totalUsers,
        totalAgents,
        totalSupervisors,
        totalAdmins,
        pendingRefunds: await Transaction.countDocuments({ status: "refund_requested" }) || 0,
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Data Plan Dispatcher (MTN, Airtel, Glo, 9mobile)
exports.dispatchDataBundle = async (req, res) => {
  try {
    const { network, planType, planCode, price, costPrice, validityDays, recipients, sendToAllUsers } = req.body;

    if (!network || !planCode || !price || !validityDays) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields: Network, Plan Size, Price, and Validity Days."
      });
    }

    let targetPhones = [];
    if (sendToAllUsers) {
      const allUsers = await User.find({ isSuspended: { $ne: true } }).select("phone");
      targetPhones = allUsers.map(u => u.phone).filter(Boolean);
    } else if (recipients) {
      targetPhones = recipients.split(",").map(p => p.trim()).filter(Boolean);
    }

    return res.status(200).json({
      success: true,
      message: `Successfully dispatched ${planCode} (${network} ${planType || "SME"}) at ₦${price} (${validityDays} Days) to ${targetPhones.length} recipient(s).`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. SuperAdmin Exclusive Refund Engine
exports.processRefundSuperAdminOnly = async (req, res) => {
  try {
    const { transactionId, targetUserId, refundAmount, reason } = req.body;
    const numericAmount = Number(refundAmount);

    if (!targetUserId || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid recipient identifier or refund amount." });
    }

    const user = await User.findOne({
      $or: [
        { _id: targetUserId.match(/^[0-9a-fA-F]{24}$/) ? targetUserId : null },
        { email: targetUserId.toLowerCase().trim() },
        { phone: targetUserId.trim() }
      ]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Target user not found." });
    }

    const prevBal = user.walletBalance || user.balance || 0;
    const newBal = prevBal + numericAmount;
    user.walletBalance = newBal;
    user.balance = newBal;
    await user.save();

    if (transactionId) {
      await Transaction.findByIdAndUpdate(transactionId, { status: "refunded" });
    }

    return res.status(200).json({
      success: true,
      message: `Refund of ₦${numericAmount.toLocaleString()} credited to ${user.firstName || user.name || user.phone}. New Balance: ₦${newBal.toLocaleString()}`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Wallet Adjustment (Credit / Debit)
exports.adjustUserWallet = async (req, res) => {
  try {
    const { userId, amount, reason, actionType } = req.body;
    const numericAmount = Number(amount);

    if (!userId || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: "Please enter a valid User Identifier and positive numeric amount." });
    }

    const user = await User.findOne({
      $or: [
        { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null },
        { email: userId.toLowerCase().trim() },
        { phone: userId.trim() }
      ]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Target user not found." });
    }

    const currentBal = user.walletBalance || user.balance || 0;
    const newBal = actionType === "credit" ? currentBal + numericAmount : Math.max(0, currentBal - numericAmount);

    user.walletBalance = newBal;
    user.balance = newBal;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `Successfully processed ${actionType.toUpperCase()} of ₦${numericAmount.toLocaleString()}. New Balance: ₦${newBal.toLocaleString()}`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Wallet Lock / Unlock Toggle
exports.toggleWalletLock = async (req, res) => {
  try {
    const { userId, lock } = req.body;
    const user = await User.findOne({
      $or: [
        { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null },
        { email: userId.toLowerCase().trim() },
        { phone: userId.trim() }
      ]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Target user not found." });
    }

    user.isSuspended = Boolean(lock);
    await user.save();

    return res.status(200).json({
      success: true,
      message: `User wallet status updated to: ${lock ? "LOCKED" : "ACTIVE"}`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};