const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

// In-Memory or DB Fallback for System Service Prices
let systemServicePrices = {
  // NIMC Printing Services
  nimc_nin: 1000,
  nimc_phone: 1000,
  nimc_trackingId: 1000,
  nimc_premiumCard: 1500,
  nimc_standardSlip: 500,
  nimc_basicSlip: 300,

  // NIN Validation Services
  val_noRecord: 1300,
  val_sim: 1300,
  val_vnin: 1300,
  val_update: 1300,
  val_bank: 1300,
  val_mod: 1700,
  val_photoError: 1400,

  // Identity & Verification Gateway
  verify_phone: 300,
  verify_bvn_basic: 200,
  verify_bvn_full: 500,
  verify_face_id: 800,

  // Surcharges for Utilities & Cable
  fee_electricity: 100,
  fee_cable: 50,
};

// 1. Telemetry, Pricing & Real-Time Financial Ledger
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

    let totalInflow = 0;
    let totalOutflow = 0;
    let successfulSalesCount = 0;
    let totalWalletFundingCount = 0;

    allTransactions.forEach((tx) => {
      const amt = Number(tx.amount || 0);
      if (
        tx.type === "wallet_funding" ||
        tx.type === "deposit" ||
        tx.category === "credit"
      ) {
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
        pendingRefunds:
          (await Transaction.countDocuments({ status: "refund_requested" })) || 0,
      },
      prices: systemServicePrices,
      recentTransactions: allTransactions.slice(0, 25),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Global Price Setup Controller (Saita Farashin Kowane Aiki)
router.post("/update-service-price", async (req, res) => {
  try {
    const { serviceKey, newPrice } = req.body;
    const numericPrice = Number(newPrice);

    if (!serviceKey || isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid service identifier or pricing amount.",
      });
    }

    systemServicePrices[serviceKey] = numericPrice;

    return res.status(200).json({
      success: true,
      message: `Updated ${serviceKey} service tariff to ₦${numericPrice.toLocaleString()}.`,
      updatedPrices: systemServicePrices,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 3. User & Staff Password Override
router.post("/override-password", async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Valid identifier and a minimum 6-character password required.",
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
      return res.status(404).json({ success: false, message: "Target account not found." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword.trim(), salt);
    await user.save();

    return res.status(200).json({
      success: true,
      message: `Password overridden successfully for ${user.firstName || user.name || user.phone}.`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Suspend / Reactivate User or Staff
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
      return res.status(404).json({ success: false, message: "Target account not found." });
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

// 5. Direct Ledger Adjustment (Credit / Debit)
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
      message: `Processed ${actionType.toUpperCase()} of ₦${numericAmount.toLocaleString()}. New Balance: ₦${newBal.toLocaleString()}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 6. SuperAdmin Exclusive Refund Engine
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

// 7. Data Plan Dispatcher
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

module.exports = router;