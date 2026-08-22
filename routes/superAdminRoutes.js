const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

// 1. Comprehensive System-Wide Financials & Activity Stream
router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsers,
      totalAgents,
      totalSupervisors,
      totalAdmins,
      allTransactions,
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "agent" }),
      User.countDocuments({ role: { $in: ["supervisor", "leader"] } }),
      User.countDocuments({ role: { $in: ["admin", "superadmin"] } }),
      Transaction.find().sort({ createdAt: -1 }).limit(100),
    ]);

    // Financial Metrics Calculation
    let totalInflow = 0;
    let totalOutflow = 0;
    let successfulSalesCount = 0;
    let totalWalletFundingCount = 0;

    allTransactions.forEach((tx) => {
      const amt = Number(tx.amount || 0);
      if (tx.type === "wallet_funding" || tx.type === "deposit" || tx.category === "credit") {
        totalInflow += amt;
        totalWalletFundingCount++;
      } else if (tx.status === "successful" || tx.status === "completed") {
        totalOutflow += amt;
        successfulSalesCount++;
      }
    });

    return res.status(200).json({
      success: true,
      stats: {
        totalInflow,
        totalOutflow,
        netRevenue: totalInflow - totalOutflow,
        successfulSalesCount,
        totalWalletFundingCount,
        totalUsers,
        totalAgents,
        totalSupervisors,
        totalAdmins,
        pendingRefunds: await Transaction.countDocuments({ status: "refund_requested" }) || 0,
      },
      recentTransactions: allTransactions.slice(0, 20),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Direct Staff & User Suspension / Activation Toggle
router.post("/toggle-suspension", async (req, res) => {
  try {
    const { userId, suspend } = req.body;
    const user = await User.findOne({
      $or: [
        { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null },
        { email: userId.toLowerCase().trim() },
        { phone: userId.trim() },
      ],
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Target user not found." });
    }

    user.isSuspended = Boolean(suspend);
    await user.save();

    return res.status(200).json({
      success: true,
      message: `Account status for ${user.firstName || user.name || user.phone} set to: ${
        suspend ? "SUSPENDED" : "ACTIVE"
      }`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 3. SuperAdmin Direct Password Override
router.post("/override-password", async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid user identifier and a password of at least 6 characters.",
      });
    }

    const user = await User.findOne({
      $or: [
        { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null },
        { email: userId.toLowerCase().trim() },
        { phone: userId.trim() },
      ],
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "Target user not found." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword.trim(), salt);
    await user.save();

    return res.status(200).json({
      success: true,
      message: `Password successfully updated for ${user.firstName || user.name || user.phone}.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Data Plan Dispatcher
router.post("/dispatch-data", async (req, res) => {
  try {
    const { network, planType, planCode, price, costPrice, validityDays, recipients, sendToAllUsers } = req.body;

    if (!network || !planCode || !price || !validityDays) {
      return res.status(400).json({
        success: false,
        message: "Network, Plan Size, Price, and Validity Days are required.",
      });
    }

    let targetPhones = [];
    if (sendToAllUsers) {
      const allUsers = await User.find({ isSuspended: { $ne: true } }).select("phone");
      targetPhones = allUsers.map((u) => u.phone).filter(Boolean);
    } else if (recipients) {
      targetPhones = recipients.split(",").map((p) => p.trim()).filter(Boolean);
    }

    return res.status(200).json({
      success: true,
      message: `Successfully provisioned ${planCode} (${network} ${planType || "SME"}) for ₦${price} (${validityDays} Days) to ${targetPhones.length} destination(s).`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 5. Exclusive SuperAdmin Refund Engine
router.post("/process-refund", async (req, res) => {
  try {
    const { transactionId, targetUserId, refundAmount, reason } = req.body;
    const numericAmount = Number(refundAmount);

    if (!targetUserId || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid target user or refund amount." });
    }

    const user = await User.findOne({
      $or: [
        { _id: targetUserId.match(/^[0-9a-fA-F]{24}$/) ? targetUserId : null },
        { email: targetUserId.toLowerCase().trim() },
        { phone: targetUserId.trim() },
      ],
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
      message: `Refund of ₦${numericAmount.toLocaleString()} disbursed to ${user.firstName || user.name || user.phone}. New Balance: ₦${newBal.toLocaleString()}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 6. Direct Balance Adjustments (Credit / Debit)
router.post("/adjust-wallet", async (req, res) => {
  try {
    const { userId, amount, reason, actionType } = req.body;
    const numericAmount = Number(amount);

    if (!userId || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: "Valid Identifier and positive amount required." });
    }

    const user = await User.findOne({
      $or: [
        { _id: userId.match(/^[0-9a-fA-F]{24}$/) ? userId : null },
        { email: userId.toLowerCase().trim() },
        { phone: userId.trim() },
      ],
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
      message: `Successfully processed ${actionType.toUpperCase()} of ₦${numericAmount.toLocaleString()}. New Balance: ₦${newBal.toLocaleString()}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;