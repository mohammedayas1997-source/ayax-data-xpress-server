const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const NIMCRequest = require("../models/NIMCRequest");
const BVNRequest = require("../models/BVNRequest");
const DataPlan = require("../models/DataPlan");
const NIMCPrice = require("../models/NIMCPrice");
const BVNPrice = require("../models/BVNPrice");

// Ayax API Gateway Base Configuration
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

const sendNotification = async (userId, title, message, category = "SUPERADMIN_ACTION") => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title,
        message,
        category,
        date: new Date(),
        isRead: false,
      });
      await user.save();
    }
  } catch (error) {
    console.error("SuperAdmin Notification Error:", error.message);
  }
};

// =========================================================================
// 1. GLOBAL TELEMETRY & GATEWAY HEALTH
// =========================================================================

exports.getGlobalDataOverview = async (req, res) => {
  try {
    const [
      totalUsers,
      totalAgents,
      totalSupervisors,
      totalAdmins,
      totalSuperAdmins,
      successfulTransactions,
      failedTransactions,
      refundedTransactions,
      revenueAgg,
      pendingRefunds,
      systemWalletLiabilities,
      pendingNIMC,
      pendingBVN,
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "agent" }),
      User.countDocuments({ role: { $in: ["supervisor", "leader"] } }),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "superadmin" }),
      Transaction.countDocuments({ status: { $in: ["success", "completed"] } }),
      Transaction.countDocuments({ status: "failed" }),
      Transaction.countDocuments({ status: "refunded" }),
      Transaction.aggregate([
        { $match: { status: { $in: ["success", "completed"] } } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
      ]),
      Transaction.countDocuments({
        $or: [
          { status: { $in: ["pending-refund", "failed"] }, isRefunded: false },
          { status: "refund_requested" },
        ],
      }),
      User.aggregate([
        {
          $group: {
            _id: null,
            totalLiabilities: {
              $sum: { $ifNull: ["$walletBalance", "$balance", 0] },
            },
          },
        },
      ]),
      NIMCRequest.countDocuments({ status: "pending" }),
      BVNRequest.countDocuments({ status: "pending" }),
    ]);

    let gatewayBalance = "N/A";
    try {
      const gwRes = await axios.get(`${AYAX_API_BASE_URL}/wallet/balance`, {
        headers: getHeaders(),
        timeout: 7000,
      });
      gatewayBalance =
        gwRes.data?.data?.balance ??
        gwRes.data?.balance ??
        gwRes.data?.walletBalance ??
        "Online";
    } catch (e) {
      gatewayBalance = "Gateway Unreachable";
    }

    return res.status(200).json({
      success: true,
      status: "success",
      stats: {
        totalRevenue: revenueAgg[0]?.totalRevenue || 0,
        totalWalletLiabilities: systemWalletLiabilities[0]?.totalLiabilities || 0,
        gatewayBalance,
        successfulTransactions,
        failedTransactions,
        refundedTransactions,
        pendingRefunds,
        pendingNIMC,
        pendingBVN,
        totalUsers,
        totalAgents,
        totalSupervisors,
        totalAdmins,
        totalSuperAdmins,
        totalPlatformAccounts:
          totalUsers + totalAgents + totalSupervisors + totalAdmins + totalSuperAdmins,
      },
    });
  } catch (error) {
    console.error("getGlobalDataOverview Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to compile global telemetry overview.",
      error: error.message,
    });
  }
};

// =========================================================================
// 2. FINANCIAL DISPATCH: CREDIT, DEBIT & DIRECT OVERRIDE REFUNDS
// =========================================================================

exports.adjustUserWallet = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId, amount, reason, actionType } = req.body;
    const numericAmount = Number(amount);
    const superAdminId = req.user?._id || req.user?.id;
    const action = String(actionType || "credit").toLowerCase();

    if (!userId || isNaN(numericAmount) || numericAmount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide a valid user identifier (ID, email, or phone) and a positive amount.",
      });
    }

    const user = await User.findOne({
      $or: [
        { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
        { email: String(userId).toLowerCase().trim() },
        { phone: String(userId).trim() },
      ],
    }).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Target user account not found.",
      });
    }

    const oldBal = Number(user.walletBalance ?? user.balance ?? 0);
    const newBal =
      action === "credit"
        ? Number((oldBal + numericAmount).toFixed(2))
        : Number(Math.max(0, oldBal - numericAmount).toFixed(2));

    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    const ref = `SUPER-ADJ-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const adjustmentTxn = new Transaction({
      user: user._id,
      transactionId: `TXN-SUPER-${Date.now()}`,
      reference: ref,
      type: action === "credit" ? "superadmin_credit" : "superadmin_debit",
      category: action === "credit" ? "CREDIT" : "DEBIT",
      amount: numericAmount,
      oldBalance: oldBal,
      newBalance: newBal,
      status: "success",
      details: `SuperAdmin ${action.toUpperCase()}: ${reason || "Direct wallet balance adjustment"}`,
      requestedBy: superAdminId,
    });
    await adjustmentTxn.save({ session });

    await session.commitTransaction();
    session.endSession();

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: action === "credit" ? "SUPERADMIN_WALLET_CREDIT" : "SUPERADMIN_WALLET_DEBIT",
      category: "FINANCIAL",
      details: `SuperAdmin performed ${action.toUpperCase()} of ₦${numericAmount.toLocaleString()} on user ${user.phone || user.email}. Reason: ${reason || "None specified"}`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      action === "credit" ? "Wallet Credited by Admin 💰" : "Wallet Debited by Admin ⚠️",
      `Your wallet balance has been ${action === "credit" ? "credited" : "debited"} with ₦${numericAmount.toLocaleString()}. Reason: ${reason || "Administrative balance sync"}. New Balance: ₦${newBal.toLocaleString()}`,
      "FINANCIAL"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully executed ${action.toUpperCase()} of ₦${numericAmount.toLocaleString()} on ${user.phone || user.email}.`,
      newBalance: newBal,
      reference: ref,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("adjustUserWallet Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to adjust target user wallet balance.",
      error: error.message,
    });
  }
};

exports.processRefundSuperAdminOnly = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId, reference, targetUserId, refundAmount, reason } = req.body;
    const superAdminId = req.user?._id || req.user?.id;

    let txn = null;
    if (transactionId || reference) {
      txn = await Transaction.findOne({
        $or: [
          { _id: mongoose.Types.ObjectId.isValid(transactionId) ? transactionId : null },
          { transactionId: transactionId || null },
          { reference: reference || null },
        ],
      }).session(session);
    }

    const recipientIdentifier = targetUserId || txn?.user;
    if (!recipientIdentifier) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide a valid transaction ID, reference, or recipient user identifier.",
      });
    }

    const user = await User.findOne({
      $or: [
        { _id: mongoose.Types.ObjectId.isValid(recipientIdentifier) ? recipientIdentifier : null },
        { email: String(recipientIdentifier).toLowerCase().trim() },
        { phone: String(recipientIdentifier).trim() },
      ],
    }).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Beneficiary user account not found.",
      });
    }

    const finalRefundAmount = Number(refundAmount || txn?.amount || 0);
    if (finalRefundAmount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Invalid refund amount provided.",
      });
    }

    const oldBal = Number(user.walletBalance ?? user.balance ?? 0);
    const newBal = Number((oldBal + finalRefundAmount).toFixed(2));

    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    if (txn) {
      txn.status = "refunded";
      txn.isRefunded = true;
      txn.refundReason = reason || "SuperAdmin direct executive refund override";
      txn.refundedBy = superAdminId;
      txn.refundedAt = new Date();
      await txn.save({ session });
    }

    const refundRef = `SUPER-REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const refundLog = new Transaction({
      user: user._id,
      transactionId: `TXN-SUPER-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "CREDIT",
      amount: finalRefundAmount,
      oldBalance: oldBal,
      newBalance: newBal,
      status: "success",
      details: `SuperAdmin Refund: ₦${finalRefundAmount.toLocaleString()} for ${txn?.reference || "Direct Override"}`,
      refundReason: reason || "Executive Overrule",
      requestedBy: superAdminId,
    });
    await refundLog.save({ session });

    await session.commitTransaction();
    session.endSession();

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: "SUPERADMIN_EXECUTIVE_REFUND",
      category: "FINANCIAL",
      details: `Executed executive refund of ₦${finalRefundAmount.toLocaleString()} to ${user.phone || user.email}`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Executive Refund Credited 💰",
      `An executive refund of ₦${finalRefundAmount.toLocaleString()} has been credited to your wallet balance. New Balance: ₦${newBal.toLocaleString()}`,
      "REFUND"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Executive refund of ₦${finalRefundAmount.toLocaleString()} successfully credited to ${user.phone || user.email}.`,
      newBalance: newBal,
      refundReference: refundRef,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("processRefundSuperAdminOnly Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to execute executive refund override.",
      error: error.message,
    });
  }
};

// =========================================================================
// 3. ROLE MANAGEMENT & SECURITY ELEVATION
// =========================================================================

exports.changeUserRole = async (req, res) => {
  try {
    const { userId, newRole } = req.body;
    const superAdminId = req.user?._id || req.user?.id;
    const normalizedRole = String(newRole || "").toLowerCase().trim();

    const allowedRoles = ["user", "agent", "supervisor", "leader", "customer_service", "admin", "superadmin"];
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Invalid role selected. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    const user = await User.findOne({
      $or: [
        { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
        { email: String(userId).toLowerCase().trim() },
        { phone: String(userId).trim() },
      ],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Target user account not found.",
      });
    }

    const previousRole = user.role;
    user.role = normalizedRole;
    await user.save();

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: "USER_ROLE_PROMOTED_OR_DEMOTED",
      category: "ADMIN_CONTROL",
      details: `Changed role of user ${user.phone || user.email} from ${previousRole.toUpperCase()} to ${normalizedRole.toUpperCase()}`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Account Role Updated 🎖️",
      `Your platform account role has been updated from ${previousRole.toUpperCase()} to ${normalizedRole.toUpperCase()}.`,
      "SYSTEM"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `User role successfully updated to ${normalizedRole.toUpperCase()}.`,
      user: {
        id: user._id,
        name: user.name || `${user.firstName || ""} ${user.surname || ""}`,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("changeUserRole Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to update target user role.",
      error: error.message,
    });
  }
};

exports.forceResetUserSecurity = async (req, res) => {
  try {
    const { userId, newPassword, newPin } = req.body;
    const superAdminId = req.user?._id || req.user?.id;

    if (!userId || (!newPassword && !newPin)) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Provide user identifier along with newPassword or newPin.",
      });
    }

    const user = await User.findOne({
      $or: [
        { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
        { email: String(userId).toLowerCase().trim() },
        { phone: String(userId).trim() },
      ],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Target user account not found.",
      });
    }

    if (newPassword) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(String(newPassword), salt);
    }

    if (newPin) {
      user.pin = String(newPin);
      user.transactionPin = String(newPin);
    }

    await user.save();

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: "SECURITY_CREDENTIALS_OVERRIDDEN",
      category: "SECURITY",
      details: `Force-reset security credentials (Password: ${Boolean(newPassword)}, PIN: ${Boolean(newPin)}) for ${user.phone || user.email}`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Security Credentials Reset 🔐",
      "Your account security credentials (Password/PIN) have been updated by administration. If you did not request this, please contact support immediately.",
      "SECURITY"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Security credentials successfully updated for user ${user.phone || user.email}.`,
    });
  } catch (error) {
    console.error("forceResetUserSecurity Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to override user security credentials.",
      error: error.message,
    });
  }
};

exports.toggleWalletLock = async (req, res) => {
  try {
    const { userId, lock, reason } = req.body;
    const superAdminId = req.user?._id || req.user?.id;

    const user = await User.findOne({
      $or: [
        { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null },
        { email: String(userId).toLowerCase().trim() },
        { phone: String(userId).trim() },
      ],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Target user account not found.",
      });
    }

    const lockState = Boolean(lock);
    user.isSuspended = lockState;
    user.status = lockState ? "suspended" : "active";
    await user.save();

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: lockState ? "ACCOUNT_LOCKED" : "ACCOUNT_UNLOCKED",
      category: "SECURITY",
      details: `${lockState ? "Locked" : "Unlocked"} user account ${user.phone || user.email}. Reason: ${reason || "Administrative review"}`,
      targetUser: user._id,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `User account is now ${lockState ? "LOCKED / SUSPENDED" : "ACTIVE / UNLOCKED"}.`,
      isSuspended: user.isSuspended,
      accountStatus: user.status,
    });
  } catch (error) {
    console.error("toggleWalletLock Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to toggle wallet account lock status.",
      error: error.message,
    });
  }
};

// =========================================================================
// 4. BULK VTU & MARKETING AUTOMATION
// =========================================================================

exports.dispatchDataBundle = async (req, res) => {
  try {
    const {
      network,
      planType,
      planCode,
      price,
      costPrice,
      validityDays,
      recipients,
      sendToAllUsers,
    } = req.body;

    if (!network || !planCode || price === undefined) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Network identifier, Plan Code, and Price are required.",
      });
    }

    let targetPhones = [];
    if (sendToAllUsers) {
      const allUsers = await User.find({ isSuspended: { $ne: true } }).select("phone");
      targetPhones = allUsers.map((u) => u.phone).filter(Boolean);
    } else if (recipients) {
      targetPhones = (Array.isArray(recipients) ? recipients : recipients.split(","))
        .map((p) => String(p).trim())
        .filter(Boolean);
    }

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      actorRole: "SUPERADMIN",
      action: "BULK_DATA_CAMPAIGN_DISPATCHED",
      category: "VTU",
      details: `Dispatched campaign ${network.toUpperCase()} ${planCode} (₦${price}) to ${targetPhones.length} recipient numbers`,
      targetUser: null,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Bulk package campaign for ${network.toUpperCase()} (${planCode}) queued for ${targetPhones.length} recipient(s).`,
      recipientCount: targetPhones.length,
    });
  } catch (error) {
    console.error("dispatchDataBundle Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to dispatch bulk data marketing bundle.",
      error: error.message,
    });
  }
};

// =========================================================================
// 5. GLOBAL PRICING & TARIFF ENGINE OVERRIDES
// =========================================================================

exports.setGlobalServicePrice = async (req, res) => {
  try {
    const { serviceCategory, serviceId, serviceType, amount, agentPrice, costPrice, name, description } = req.body;
    const category = String(serviceCategory || "").toLowerCase().trim();

    if (!category || (!serviceId && !serviceType) || amount === undefined) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Provide serviceCategory (nimc, bvn, or data), identifier key, and amount.",
      });
    }

    const priceNum = Number(amount);
    const agentPriceNum = agentPrice !== undefined ? Number(agentPrice) : priceNum;
    const costPriceNum = costPrice !== undefined ? Number(costPrice) : 0;
    const key = String(serviceId || serviceType).trim();

    let updatedDoc;

    if (category === "nimc" || category === "nin") {
      updatedDoc = await NIMCPrice.findOneAndUpdate(
        { $or: [{ serviceId: key }, { serviceType: key }] },
        {
          serviceId: key,
          serviceType: key,
          name: name || key,
          amount: priceNum,
          agentPrice: agentPriceNum,
          costPrice: costPriceNum,
          description: description || "",
          isActive: true,
          updatedBy: req.user._id,
        },
        { upsert: true, new: true, runValidators: true }
      );
    } else if (category === "bvn") {
      updatedDoc = await BVNPrice.findOneAndUpdate(
        { $or: [{ serviceId: key }, { serviceType: key }] },
        {
          serviceId: key,
          serviceType: key,
          name: name || key,
          amount: priceNum,
          agentPrice: agentPriceNum,
          costPrice: costPriceNum,
          description: description || "",
          isActive: true,
          updatedBy: req.user._id,
        },
        { upsert: true, new: true, runValidators: true }
      );
    } else if (category === "data") {
      updatedDoc = await DataPlan.findOneAndUpdate(
        { planCode: key },
        {
          userPrice: priceNum,
          agentPrice: agentPriceNum,
          costPrice: costPriceNum,
          isActive: true,
        },
        { new: true }
      );
    } else {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Unsupported service category. Use: 'nimc', 'bvn', or 'data'.",
      });
    }

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      actorRole: "SUPERADMIN",
      action: "GLOBAL_PRICING_UPDATED",
      category: "ADMIN_CONTROL",
      details: `Updated ${category.toUpperCase()} tariff [${key}] - User: ₦${priceNum}, Agent: ₦${agentPriceNum}, Cost: ₦${costPriceNum}`,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully updated ${category.toUpperCase()} pricing matrix.`,
      data: updatedDoc,
    });
  } catch (error) {
    console.error("setGlobalServicePrice Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to update global pricing tariff.",
      error: error.message,
    });
  }
};

// =========================================================================
// 6. SYSTEM PURGE & FORENSIC AUDIT EXPUNGING
// =========================================================================

exports.expungeSystemAuditLogs = async (req, res) => {
  try {
    const { retentionDays } = req.body;
    const days = parseInt(retentionDays, 10) || 90;

    const thresholdDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deleteResult = await Activity.deleteMany({
      createdAt: { $lt: thresholdDate },
    });

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      actorRole: "SUPERADMIN",
      action: "AUDIT_TRAIL_EXPUNGED",
      category: "SYSTEM",
      details: `Expunged ${deleteResult.deletedCount} activity records older than ${days} days`,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully pruned ${deleteResult.deletedCount} forensic records older than ${days} days.`,
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error("expungeSystemAuditLogs Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to prune audit logs.",
      error: error.message,
    });
  }
};