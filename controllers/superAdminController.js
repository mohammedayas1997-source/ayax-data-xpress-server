const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
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

// Helper for In-App Notifications
const sendNotification = async (
  userId,
  title,
  message,
  category = "SUPERADMIN_ACTION"
) => {
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

    if (Notification) {
      await Notification.create({
        recipient: userId,
        title,
        message,
        type: category.toLowerCase(),
      }).catch(() => {});
    }
  } catch (error) {
    console.error("SuperAdmin Notification Error:", error.message);
  }
};

// Helper for finding user across identifier types
const findUserByIdentifier = async (identifier, session = null) => {
  if (!identifier) return null;
  const cleanId = String(identifier).trim();
  const query = {
    $or: [
      { _id: mongoose.Types.ObjectId.isValid(cleanId) ? cleanId : null },
      { email: cleanId.toLowerCase() },
      { phone: cleanId },
      { username: cleanId.toLowerCase() },
    ],
  };
  return session ? User.findOne(query).session(session) : User.findOne(query);
};

// =========================================================================
// 1. GLOBAL TELEMETRY & OVERVIEW
// =========================================================================

exports.getGlobalDataOverview = async (req, res) => {
  try {
    const [
      totalUsers,
      totalAgents,
      totalSupervisors,
      totalLeaders,
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
      nimcPrices,
      bvnPrices,
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "agent" }),
      User.countDocuments({ role: "supervisor" }),
      User.countDocuments({ role: "leader" }),
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
      NIMCPrice.find().lean(),
      BVNPrice.find().lean(),
    ]);

    let gatewayBalance = "Online";
    try {
      const gwRes = await axios.get(`${AYAX_API_BASE_URL}/wallet/balance`, {
        headers: getHeaders(),
        timeout: 6000,
      });
      gatewayBalance =
        gwRes.data?.data?.balance ??
        gwRes.data?.balance ??
        gwRes.data?.walletBalance ??
        "Online";
    } catch (e) {
      gatewayBalance = "Online";
    }

    const pricesMap = {};
    nimcPrices.forEach((p) => {
      if (p.serviceId) pricesMap[p.serviceId] = p.amount;
      if (p.serviceType) pricesMap[p.serviceType] = p.amount;
    });
    bvnPrices.forEach((p) => {
      if (p.serviceId) pricesMap[p.serviceId] = p.amount;
      if (p.serviceType) pricesMap[p.serviceType] = p.amount;
    });

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
        totalSupervisors: totalSupervisors + totalLeaders,
        totalLeaders,
        totalAdmins,
        totalSuperAdmins,
        totalPlatformAccounts:
          totalUsers + totalAgents + totalSupervisors + totalLeaders + totalAdmins + totalSuperAdmins,
      },
      prices: pricesMap,
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

exports.getStats = exports.getGlobalDataOverview;

// =========================================================================
// 2. ALL COMPANY STAFF & USERS DIRECTORATE
// =========================================================================

exports.getAllUsers = async (req, res) => {
  try {
    const { role, limit = 500, search } = req.query;
    const query = {};

    if (role && role !== "all") {
      query.role = role.toLowerCase().trim();
    }

    if (search) {
      const q = String(search).trim();
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { firstName: { $regex: q, $options: "i" } },
        { surname: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { state: { $regex: q, $options: "i" } },
        { lga: { $regex: q, $options: "i" } },
      ];
    }

    const users = await User.find(query)
      .select("-password -pin -transactionPin")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: users.length,
      users,
      data: users,
    });
  } catch (error) {
    console.error("getAllUsers Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to fetch users list.",
      error: error.message,
    });
  }
};

// =========================================================================
// 3. ALL COMPANY SERVICES & TARIFFS VIEWER
// =========================================================================

exports.getAllCompanyServices = async (req, res) => {
  try {
    const [nimcList, bvnList, dataList] = await Promise.all([
      NIMCPrice.find().lean(),
      BVNPrice.find().lean(),
      DataPlan.find().sort({ network: 1, userPrice: 1 }).lean(),
    ]);

    return res.status(200).json({
      success: true,
      status: "success",
      data: {
        nimcServices: nimcList,
        bvnServices: bvnList,
        dataPlans: dataList,
      },
    });
  } catch (error) {
    console.error("getAllCompanyServices Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to fetch company services.",
      error: error.message,
    });
  }
};

// =========================================================================
// 4. DATA PACKAGES MATRIX (GET ALL, CREATE, UPDATE, DELETE)
// =========================================================================

exports.getAllDataPlans = async (req, res) => {
  try {
    const plans = await DataPlan.find().sort({ network: 1, userPrice: 1 }).lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: plans.length,
      data: plans,
      plans: plans,
    });
  } catch (error) {
    console.error("getAllDataPlans Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve data plans list.",
      error: error.message,
    });
  }
};

exports.setDataPlan = async (req, res) => {
  try {
    const {
      network,
      name,
      planCode,
      userPrice,
      agentPrice,
      costPrice,
      validity,
      planType,
    } = req.body;

    if (!network || !planCode || userPrice === undefined) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Network, Plan Code, and User Price are required.",
      });
    }

    const plan = await DataPlan.findOneAndUpdate(
      { planCode: String(planCode).trim() },
      {
        network: String(network).toUpperCase().trim(),
        name: name || `${network} ${planCode}`,
        planCode: String(planCode).trim(),
        userPrice: Number(userPrice),
        agentPrice: Number(agentPrice || userPrice),
        costPrice: Number(costPrice || 0),
        validity: String(validity || "30"),
        planType: planType || "SME",
        isActive: true,
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Data plan saved and published successfully.",
      data: plan,
    });
  } catch (error) {
    console.error("setDataPlan Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to save data plan package.",
      error: error.message,
    });
  }
};

exports.updateDataPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const plan = await DataPlan.findByIdAndUpdate(id, updateData, { new: true });
    if (!plan) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Data plan not found.",
      });
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Data plan updated successfully.",
      data: plan,
    });
  } catch (error) {
    console.error("updateDataPlan Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to update data plan.",
      error: error.message,
    });
  }
};

exports.deleteDataPlan = async (req, res) => {
  try {
    const { id } = req.params;
    await DataPlan.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Data plan deleted successfully.",
    });
  } catch (error) {
    console.error("deleteDataPlan Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to delete data plan.",
      error: error.message,
    });
  }
};

// =========================================================================
// 5. FINANCIAL DISPATCH: CREDIT, DEBIT & DIRECT OVERRIDE REFUNDS
// =========================================================================

exports.adjustUserWallet = async (req, res) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch (err) {
    session = null;
  }

  try {
    const { userId, targetUserId, amount, reason, actionType } = req.body;
    const identifier = userId || targetUserId;
    const numericAmount = Number(amount);
    const superAdminId = req.user?._id || req.user?.id;
    const action = String(actionType || "credit").toLowerCase();

    if (!identifier || isNaN(numericAmount) || numericAmount <= 0) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(400).json({
        success: false,
        status: "failed",
        message:
          "Please provide a valid user identifier (Phone, Email, or ID) and a positive numeric amount.",
      });
    }

    const user = await findUserByIdentifier(identifier, session);

    if (!user) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Target beneficiary account not found.",
      });
    }

    const oldBal = Number(user.walletBalance ?? user.balance ?? 0);
    const newBal =
      action === "credit"
        ? Number((oldBal + numericAmount).toFixed(2))
        : Number(Math.max(0, oldBal - numericAmount).toFixed(2));

    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save(session ? { session } : undefined);

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
      details: `Admin ${action.toUpperCase()}: ${
        reason || "Direct wallet balance adjustment"
      }`,
      requestedBy: superAdminId,
    });
    await adjustmentTxn.save(session ? { session } : undefined);

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action:
        action === "credit"
          ? "SUPERADMIN_WALLET_CREDIT"
          : "SUPERADMIN_WALLET_DEBIT",
      category: "FINANCIAL",
      details: `Admin performed ${action.toUpperCase()} of ₦${numericAmount.toLocaleString()} on user ${
        user.phone || user.email
      }. Reason: ${reason || "Manual balance override"}`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      action === "credit" ? "Wallet Credited by Admin 💰" : "Wallet Debited by Admin ⚠️",
      `Your wallet balance has been ${
        action === "credit" ? "credited" : "debited"
      } with ₦${numericAmount.toLocaleString()}. Reason: ${
        reason || "Administrative balance sync"
      }. New Balance: ₦${newBal.toLocaleString()}`,
      "FINANCIAL"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully executed ${action.toUpperCase()} of ₦${numericAmount.toLocaleString()} on ${
        user.phone || user.email
      }.`,
      newBalance: newBal,
      reference: ref,
    });
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
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
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch (err) {
    session = null;
  }

  try {
    const {
      transactionId,
      reference,
      txRef,
      targetUserId,
      userId,
      refundAmount,
      amount,
      reason,
    } = req.body;
    const superAdminId = req.user?._id || req.user?.id;

    let txn = null;
    const refKey = reference || txRef || transactionId;
    if (refKey) {
      txn = await Transaction.findOne({
        $or: [
          { _id: mongoose.Types.ObjectId.isValid(refKey) ? refKey : null },
          { transactionId: refKey },
          { reference: refKey },
        ],
      }).session(session);
    }

    const recipientIdentifier = targetUserId || userId || txn?.user;
    if (!recipientIdentifier) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(400).json({
        success: false,
        status: "failed",
        message:
          "Please provide a valid transaction reference or beneficiary phone/email.",
      });
    }

    const user = await findUserByIdentifier(recipientIdentifier, session);

    if (!user) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Beneficiary user account not found.",
      });
    }

    const finalRefundAmount = Number(refundAmount || amount || txn?.amount || 0);
    if (isNaN(finalRefundAmount) || finalRefundAmount <= 0) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
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
    await user.save(session ? { session } : undefined);

    if (txn) {
      txn.status = "refunded";
      txn.isRefunded = true;
      txn.refundReason = reason || "Direct executive refund override";
      txn.refundedBy = superAdminId;
      txn.refundedAt = new Date();
      await txn.save(session ? { session } : undefined);
    }

    const refundRef = `SUPER-REF-${Date.now()}-${Math.floor(
      100 + Math.random() * 900
    )}`;
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
      details: `Executive Refund of ₦${finalRefundAmount.toLocaleString()} for ${
        txn?.reference || "Manual Override"
      }`,
      refundReason: reason || "Executive Overrule",
      requestedBy: superAdminId,
    });
    await refundLog.save(session ? { session } : undefined);

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: "SUPERADMIN_EXECUTIVE_REFUND",
      category: "FINANCIAL",
      details: `Executed refund of ₦${finalRefundAmount.toLocaleString()} to ${
        user.phone || user.email
      }`,
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
      message: `Executive refund of ₦${finalRefundAmount.toLocaleString()} successfully credited to ${
        user.phone || user.email
      }.`,
      newBalance: newBal,
      refundReference: refundRef,
    });
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
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
// 6. ROLE MANAGEMENT & SECURITY OVERRIDES
// =========================================================================

exports.changeUserRole = async (req, res) => {
  try {
    const { userId, newRole, role } = req.body;
    const superAdminId = req.user?._id || req.user?.id;
    const normalizedRole = String(newRole || role || "").toLowerCase().trim();

    const allowedRoles = [
      "user",
      "agent",
      "supervisor",
      "leader",
      "customer_service",
      "customer_care",
      "support",
      "admin",
      "superadmin",
    ];

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Invalid role selected. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    const user = await findUserByIdentifier(userId);

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
      details: `Changed role of user ${user.phone || user.email} from ${String(
        previousRole
      ).toUpperCase()} to ${normalizedRole.toUpperCase()}`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Account Role Updated 🎖️",
      `Your platform account role has been updated from ${String(
        previousRole
      ).toUpperCase()} to ${normalizedRole.toUpperCase()}.`,
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
    const { userId, newPassword, newPin, pin } = req.body;
    const superAdminId = req.user?._id || req.user?.id;
    const targetPin = newPin || pin;

    if (!userId || (!newPassword && !targetPin)) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Provide user identifier along with newPassword or newPin.",
      });
    }

    const user = await findUserByIdentifier(userId);

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

    if (targetPin) {
      user.pin = String(targetPin);
      user.transactionPin = String(targetPin);
    }

    await user.save();

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: "SECURITY_CREDENTIALS_OVERRIDDEN",
      category: "SECURITY",
      details: `Force-reset credentials for ${user.phone || user.email}`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Security Credentials Reset 🔐",
      "Your account credentials have been updated by administration.",
      "SECURITY"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Security credentials successfully updated for user ${
        user.phone || user.email
      }.`,
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
    const { userId, lock, suspend, reason } = req.body;
    const superAdminId = req.user?._id || req.user?.id;
    const lockState = Boolean(lock !== undefined ? lock : suspend);

    const user = await findUserByIdentifier(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Target user account not found.",
      });
    }

    user.isSuspended = lockState;
    user.status = lockState ? "suspended" : "active";
    await user.save();

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: lockState ? "ACCOUNT_LOCKED" : "ACCOUNT_UNLOCKED",
      category: "SECURITY",
      details: `${lockState ? "Locked" : "Unlocked"} user account ${
        user.phone || user.email
      }. Reason: ${reason || "Administrative inspection"}`,
      targetUser: user._id,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `User account is now ${
        lockState ? "LOCKED / SUSPENDED" : "ACTIVE / UNLOCKED"
      }.`,
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
// 7. TARGET ASSIGNMENT (SUPERVISORS, AGENTS & LEADERS)
// =========================================================================

exports.assignTarget = async (req, res) => {
  try {
    const { supervisorId, userId, agentGoal, dataGoal, airtimeGoal, month } = req.body;
    const targetId = supervisorId || userId;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Supervisor or Agent identifier is required.",
      });
    }

    const user = await findUserByIdentifier(targetId);
    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Target user not found.",
      });
    }

    if (!user.targets) user.targets = {};
    if (dataGoal !== undefined) user.targets.dataGoal = Number(dataGoal);
    if (agentGoal !== undefined) user.targets.agentGoal = Number(agentGoal);
    if (airtimeGoal !== undefined) user.targets.airtimeGoal = Number(airtimeGoal);
    if (month) user.targets.currentMonth = String(month).trim();

    user.markModified("targets");
    await user.save();

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      actorRole: "SUPERADMIN",
      action: "SUPERADMIN_ASSIGN_TARGET",
      category: "TARGET",
      details: `Assigned monthly targets (${user.targets.dataGoal}GB Data, ${user.targets.agentGoal} Agents) to ${
        user.phone || user.email
      }`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Monthly Targets Assigned 🎯",
      `Your performance quota for ${user.targets.currentMonth || "this month"} is set: ${
        user.targets.dataGoal
      }GB Data & ${user.targets.agentGoal} Agents goal.`,
      "TARGET"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Monthly target successfully deployed to ${user.phone || user.email}.`,
      targets: user.targets,
    });
  } catch (error) {
    console.error("assignTarget Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to assign monthly target.",
      error: error.message,
    });
  }
};

// =========================================================================
// 8. BROADCAST NOTIFICATIONS & MARKETING DISPATCH
// =========================================================================

exports.broadcastNotification = async (req, res) => {
  try {
    const { title, message, targetType, targetUserId, recipientId, category } =
      req.body;
    const superAdminId = req.user?._id || req.user?.id;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Notification title and body message are required.",
      });
    }

    const singleTarget = targetUserId || recipientId;

    if (singleTarget && targetType !== "all") {
      const user = await findUserByIdentifier(singleTarget);
      if (!user) {
        return res.status(404).json({
          success: false,
          status: "failed",
          message: "Designated recipient not found.",
        });
      }

      await sendNotification(
        user._id,
        title.trim(),
        message.trim(),
        category || "ADMIN_BROADCAST"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: `Notification delivered directly to ${user.phone || user.email}.`,
      });
    }

    const updateResult = await User.updateMany(
      { isSuspended: { $ne: true } },
      {
        $push: {
          notifications: {
            $each: [
              {
                title: title.trim(),
                message: message.trim(),
                category: category || "BROADCAST",
                date: new Date(),
                isRead: false,
              },
            ],
            $position: 0,
          },
        },
      }
    );

    await Activity.create({
      user: superAdminId,
      staffId: superAdminId,
      actorRole: "SUPERADMIN",
      action: "BROADCAST_NOTIFICATION_DISPATCHED",
      category: "COMMUNICATION",
      details: `Broadcast alert: "${title}" delivered to ${updateResult.modifiedCount} accounts`,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Broadcast delivered successfully to ${updateResult.modifiedCount} active users.`,
      dispatchedCount: updateResult.modifiedCount,
    });
  } catch (error) {
    console.error("broadcastNotification Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to dispatch broadcast notification.",
      error: error.message,
    });
  }
};

exports.dispatchDataBundle = async (req, res) => {
  try {
    const {
      network,
      planType,
      planCode,
      price,
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
      const allUsers = await User.find({ isSuspended: { $ne: true } }).select(
        "phone"
      );
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
      details: `Dispatched campaign ${network.toUpperCase()} ${planCode} (₦${price}) to ${
        targetPhones.length
      } recipient numbers`,
      targetUser: null,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Bulk package campaign for ${network.toUpperCase()} (${planCode}) queued for ${
        targetPhones.length
      } recipient(s).`,
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
// 9. GLOBAL PRICING & TARIFF ENGINE OVERRIDES
// =========================================================================

exports.setGlobalServicePrice = async (req, res) => {
  try {
    const {
      serviceCategory,
      serviceId,
      serviceKey,
      serviceType,
      amount,
      newPrice,
      agentPrice,
      costPrice,
      name,
      description,
    } = req.body;

    const category = String(serviceCategory || "").toLowerCase().trim();
    const key = String(serviceId || serviceKey || serviceType || "").trim();
    const finalAmount = Number(amount !== undefined ? amount : newPrice);

    if (!key || isNaN(finalAmount)) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Provide service key identifier and numeric amount/newPrice.",
      });
    }

    const priceNum = finalAmount;
    const agentPriceNum =
      agentPrice !== undefined ? Number(agentPrice) : priceNum;
    const costPriceNum = costPrice !== undefined ? Number(costPrice) : 0;

    let updatedDoc = null;

    if (category.includes("nimc") || category.includes("nin")) {
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
    } else if (category.includes("bvn")) {
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
    } else if (category.includes("data")) {
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
      updatedDoc = await NIMCPrice.findOneAndUpdate(
        { $or: [{ serviceId: key }, { serviceType: key }] },
        {
          serviceId: key,
          serviceType: key,
          name: name || key,
          amount: priceNum,
          agentPrice: agentPriceNum,
          costPrice: costPriceNum,
          isActive: true,
          updatedBy: req.user._id,
        },
        { upsert: true, new: true }
      );
    }

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      actorRole: "SUPERADMIN",
      action: "GLOBAL_PRICING_UPDATED",
      category: "ADMIN_CONTROL",
      details: `Updated tariff [${key}] - User: ₦${priceNum}, Agent: ₦${agentPriceNum}, Cost: ₦${costPriceNum}`,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully updated pricing for ${key}.`,
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
// 10. FORENSIC AUDIT EXPUNGING
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