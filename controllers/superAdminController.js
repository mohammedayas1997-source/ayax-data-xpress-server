const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");

// DYNAMIC MODEL LOADERS (Protects against missing models)
let NIMCRequest;
try {
  NIMCRequest = require("../models/NIMCRequest");
} catch (e) {
  NIMCRequest = null;
}

let BVNRequest;
try {
  BVNRequest = require("../models/BVNRequest");
} catch (e) {
  BVNRequest = null;
}

let DataPlan;
try {
  DataPlan = require("../models/DataPlan");
} catch (e) {
  DataPlan = null;
}

let NIMCPrice;
try {
  NIMCPrice = require("../models/NIMCPrice");
} catch (e) {
  NIMCPrice = null;
}

let BVNPrice;
try {
  BVNPrice = require("../models/BVNPrice");
} catch (e) {
  BVNPrice = null;
}

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

// ROLE-BASED WELCOME NOTIFICATION GENERATOR
const getWelcomeMessageByRole = (user) => {
  const role = String(user.role || "user").toLowerCase().trim();
  const name = user.firstName || user.name || "Member";
  const state = user.state || "Nigeria";
  const lga = user.lga ? `(${user.lga} LGA)` : "";

  switch (role) {
    case "national_sales_director":
    case "super_leader":
      return {
        title: "Executive Welcome: National Sales Directorate 👑",
        message: `Welcome, ${name}! Your executive portal as National Sales Director (NSD) has been initialized. You have overarching authority to supervise State Managers, allocate state quotas, and oversee nationwide VTU & identity operations.`,
        category: "APPOINTMENT",
      };

    case "state_manager":
    case "leader":
      return {
        title: "Executive Appointment: State Management Directorate 🏛️",
        message: `Welcome, ${name}! You have been appointed as the official State Manager (SM) for ${state} State. Your command console is live to monitor Field Supervisors, track retail agents, and drive regional sales quotas.`,
        category: "APPOINTMENT",
      };

    case "supervisor":
    case "field_supervisor":
      return {
        title: "Field Appointment: Field Operations Supervisor 👔",
        message: `Welcome, ${name}! Your Field Supervisor portal for ${state} ${lga} is now active. You can now onboard, verify, and mentor retail agents, track daily bundle allocations, and supervise regional distribution.`,
        category: "APPOINTMENT",
      };

    case "agent":
      return {
        title: "Welcome to Ayax Retail Agent Network 🏪",
        message: `Welcome on board, Agent ${name}! Your merchant terminal is active. Enjoy exclusive wholesale prices on Data bundles, Airtime VTU, Electricity Tokens, Cable TV, and NIMC/BVN validation services. Start vending and maximize your daily commissions!`,
        category: "WELCOME_AGENT",
      };

    case "support":
    case "customer_service":
    case "customer_care":
      return {
        title: "Ayax Support Desk: Terminal Access Granted 🎧",
        message: `Welcome, ${name}! Your customer resolution and support terminal is provisioned. You can investigate transaction logs, trace NIMC/BVN queries, and escalate customer disputes directly to administration.`,
        category: "SYSTEM_ACCESS",
      };

    case "admin":
      return {
        title: "Operations Command: Admin Console Active 🛡️",
        message: `Welcome, ${name}! Your Operations Administrator account is live. You have elevated access to oversee daily platform operations, service uptime, and support investigations.`,
        category: "ADMIN_ACCESS",
      };

    default: // Normal Customer / User
      return {
        title: "Welcome to Ayax Data Xpress 🚀",
        message: `Welcome, ${name}! Your digital wallet and service portal are fully operational. Enjoy instant, automated delivery for ultra-cheap Data, VTU Airtime, Utility bills, and Identity verification 24/7. Fund your wallet to get started!`,
        category: "WELCOME",
      };
  }
};

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
      await user.save({ validateBeforeSave: false });
    }

    if (Notification) {
      await Notification.create({
        recipient: userId,
        user: userId,
        title,
        message,
        category: category.toUpperCase(),
        type: category.toLowerCase(),
        isRead: false,
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
      { phone: cleanId.replace(/^0/, "+234") },
      { phone: cleanId.replace(/^\+234/, "0") },
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
      totalStateManagers,
      totalDirectors,
      totalAdmins,
      totalSuperAdmins,
      successfulTransactions,
      failedTransactions,
      refundedTransactions,
      revenueAgg,
      pendingRefundsCount,
      systemWalletLiabilities,
      pendingNIMC,
      pendingBVN,
      nimcPrices,
      bvnPrices,
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "agent" }),
      User.countDocuments({ role: { $in: ["supervisor", "field_supervisor"] } }),
      User.countDocuments({ role: { $in: ["leader", "state_manager"] } }),
      User.countDocuments({ role: { $in: ["national_sales_director", "super_leader"] } }),
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
          { status: "pending-refund" },
          { status: "refund_requested" },
          { refundReason: { $exists: true, $ne: "" }, status: { $ne: "refunded" } },
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
      NIMCRequest ? NIMCRequest.countDocuments({ status: "pending" }) : 0,
      BVNRequest ? BVNRequest.countDocuments({ status: "pending" }) : 0,
      NIMCPrice ? NIMCPrice.find().lean() : [],
      BVNPrice ? BVNPrice.find().lean() : [],
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
    if (Array.isArray(nimcPrices)) {
      nimcPrices.forEach((p) => {
        if (p.serviceId) pricesMap[p.serviceId] = p.amount;
        if (p.serviceType) pricesMap[p.serviceType] = p.amount;
      });
    }
    if (Array.isArray(bvnPrices)) {
      bvnPrices.forEach((p) => {
        if (p.serviceId) pricesMap[p.serviceId] = p.amount;
        if (p.serviceType) pricesMap[p.serviceType] = p.amount;
      });
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
        pendingRefunds: pendingRefundsCount,
        pendingNIMC,
        pendingBVN,
        totalUsers,
        totalAgents,
        totalSupervisors,
        totalLeaders: totalStateManagers,
        totalDirectors,
        totalAdmins,
        totalSuperAdmins,
        totalPlatformAccounts:
          totalUsers + totalAgents + totalSupervisors + totalStateManagers + totalDirectors + totalAdmins + totalSuperAdmins,
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
// 2. DIRECT USER CREATION & STAFF APPOINTMENT
// =========================================================================

exports.createUser = async (req, res) => {
  try {
    const {
      firstName,
      surname,
      name,
      email,
      phone,
      password,
      role,
      state,
      lga,
      walletBalance,
      supervisorId,
    } = req.body;

    if (!phone || (!firstName && !name)) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "First Name and Phone Number are required.",
      });
    }

    const cleanPhone = String(phone).trim();
    const cleanEmail = email
      ? String(email).toLowerCase().trim()
      : `${cleanPhone}@ayaxdata.online`;

    let existingUser = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "An account with this phone number or email already exists.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || "Password123@", salt);
    const first = firstName || (name ? name.split(" ")[0] : "Staff");
    const sur = surname || (name ? name.split(" ").slice(1).join(" ") : "Member");
    const fullName = name || `${first} ${sur}`.trim();
    const initialBal = Number(walletBalance || 0);

    const newUser = await User.create({
      firstName: first,
      surname: sur,
      name: fullName.toUpperCase(),
      email: cleanEmail,
      phone: cleanPhone,
      password: hashedPassword,
      role: String(role || "agent").toLowerCase().trim(),
      state: state || "Kano",
      lga: lga || "Ajingi",
      walletBalance: initialBal,
      balance: initialBal,
      assignedSupervisor: supervisorId || undefined,
      pin: "2026",
      transactionPin: "2026",
      isSuspended: false,
      isVerified: true,
      status: "active",
      targets: {
        dataGoal: 500,
        agentGoal: 10,
        airtimeGoal: 0,
        currentMonth: "August 2026",
      },
    });

    // Automated Welcome Notification based on Assigned Role
    const welcome = getWelcomeMessageByRole(newUser);
    const welcomeNotifObj = {
      title: welcome.title,
      message: welcome.message,
      category: welcome.category,
      date: new Date(),
      createdAt: new Date(),
      isRead: false,
      read: false,
    };

    if (!newUser.notifications) newUser.notifications = [];
    newUser.notifications.unshift(welcomeNotifObj);
    await newUser.save({ validateBeforeSave: false });

    if (Notification) {
      await Notification.create({
        recipient: newUser._id,
        user: newUser._id,
        userId: newUser._id,
        title: welcome.title,
        message: welcome.message,
        category: welcome.category,
        type: "appointment",
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        createdAt: new Date(),
      }).catch(() => {});
    }

    if (Activity && req.user?._id) {
      await Activity.create({
        user: req.user._id,
        staffId: req.user._id,
        actorRole: "SUPERADMIN",
        action: "USER_PROVISIONED_BY_SUPERADMIN",
        category: "ADMIN_CONTROL",
        details: `SuperAdmin provisioned ${fullName} (${cleanPhone}) as ${newUser.role.toUpperCase()}`,
        targetUser: newUser._id,
      }).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      status: "success",
      message: `Account successfully provisioned for ${fullName} as ${newUser.role.toUpperCase()}.`,
      data: newUser,
      user: newUser,
    });
  } catch (error) {
    console.error("createUser Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to create and save user in database.",
      error: error.message,
    });
  }
};

// =========================================================================
// 3. ALL COMPANY STAFF & USERS DIRECTORATE
// =========================================================================

exports.getAllUsers = async (req, res) => {
  try {
    const { role, limit = 500, search } = req.query;
    const query = {};

    if (role && role !== "all") {
      const r = role.toLowerCase().trim();
      if (r === "supervisor") {
        query.role = { $in: ["supervisor", "field_supervisor"] };
      } else if (r === "leader" || r === "state_manager") {
        query.role = { $in: ["leader", "state_manager"] };
      } else if (r === "national_sales_director" || r === "super_leader") {
        query.role = { $in: ["national_sales_director", "super_leader"] };
      } else {
        query.role = r;
      }
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
// 4. REFUND DISPUTE QUEUE & APPROVAL ENGINE
// =========================================================================

exports.getRefundRequests = async (req, res) => {
  try {
    const requests = await Transaction.find({
      $or: [
        { status: "pending-refund" },
        { status: "refund_requested" },
        { refundReason: { $exists: true, $ne: "" }, status: { $ne: "refunded" } },
      ],
    })
      .populate("user", "name firstName surname phone email walletBalance")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: requests.length,
      requests,
      data: requests,
    });
  } catch (error) {
    console.error("getRefundRequests Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to fetch refund queue.",
      error: error.message,
    });
  }
};

// =========================================================================
// STRICT DIRECT REFUND APPROVAL (TARGET USER ONLY)
// =========================================================================
exports.approveRefund = async (req, res) => {
  try {
    const { transactionId, reference, beneficiary, refundAmount, reason } = req.body;
    const superAdminId = req.user?._id || req.user?.id;

    let targetTx = null;
    if (transactionId && mongoose.Types.ObjectId.isValid(transactionId)) {
      targetTx = await Transaction.findById(transactionId);
    } else if (reference) {
      targetTx = await Transaction.findOne({
        $or: [{ reference }, { transactionId: reference }],
      });
    }

    // 1. Identify the intended beneficiary account
    const targetUserIdentifier = beneficiary || targetTx?.user;
    const user = await findUserByIdentifier(targetUserIdentifier);

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Beneficiary user account not found.",
      });
    }

    const amount = Number(refundAmount || targetTx?.amount || 0);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Invalid refund amount.",
      });
    }

    // 2. Increment wallet balance for the beneficiary only
    const oldBal = Number(user.walletBalance ?? user.balance ?? 0);
    const newBal = Number((oldBal + amount).toFixed(2));

    user.walletBalance = newBal;
    user.balance = newBal;

    // 3. Append notification strictly into this user's notifications array
    const refundNotifObj = {
      title: "Refund Approved & Credited 💳",
      message: `Your refund claim of ₦${amount.toLocaleString()} for transaction (${targetTx?.reference || "Disputed Service"}) has been approved. New Wallet Balance: ₦${newBal.toLocaleString()}`,
      category: "REFUND",
      date: new Date(),
      createdAt: new Date(),
      isRead: false,
      read: false,
    };

    if (!user.notifications) user.notifications = [];
    user.notifications.unshift(refundNotifObj);
    if (user.notifications.length > 100) {
      user.notifications = user.notifications.slice(0, 100);
    }

    await user.save({ validateBeforeSave: false });

    // 4. Update the transaction status
    if (targetTx) {
      targetTx.status = "refunded";
      targetTx.isRefunded = true;
      targetTx.refundReason = reason || "SuperAdmin Approved Refund";
      targetTx.refundedBy = superAdminId;
      targetTx.refundedAt = new Date();
      await targetTx.save({ validateBeforeSave: false });
    }

    // 5. Create refund transaction record
    const refCode = `REFUND-${Date.now()}`;
    await Transaction.create({
      user: user._id,
      userId: user._id,
      transactionId: `TXN-${refCode}`,
      reference: refCode,
      type: "refund",
      category: "CREDIT",
      amount: amount,
      oldBalance: oldBal,
      newBalance: newBal,
      status: "success",
      details: `Executive Refund Disbursed for ${targetTx?.reference || "Disputed Transaction"}`,
      refundReason: reason || "Approved by SuperAdmin",
      requestedBy: superAdminId,
    });

    // 6. Persist to Notification Collection for the specific user
    if (Notification) {
      await Notification.create({
        recipient: user._id,
        user: user._id,
        userId: user._id,
        title: "Refund Approved & Credited 💳",
        message: `Your refund claim of ₦${amount.toLocaleString()} for transaction (${targetTx?.reference || "Disputed Service"}) has been approved. New Wallet Balance: ₦${newBal.toLocaleString()}`,
        category: "REFUND",
        type: "refund",
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        targetRole: undefined,
        createdAt: new Date(),
      }).catch(() => {});
    }

    // 7. Log administrative activity
    if (Activity && superAdminId) {
      await Activity.create({
        user: superAdminId,
        staffId: superAdminId,
        actorRole: "SUPERADMIN",
        action: "REFUND_APPROVED",
        category: "FINANCIAL",
        details: `Approved refund of ₦${amount.toLocaleString()} strictly to user ${user.phone || user.email}`,
        targetUser: user._id,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: `₦${amount.toLocaleString()} successfully refunded exclusively to ${user.phone || user.email}.`,
      newBalance: newBal,
      targetUser: user.phone || user.email,
    });
  } catch (error) {
    console.error("approveRefund Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to approve and execute refund.",
      error: error.message,
    });
  }
};

exports.processRefundSuperAdminOnly = exports.approveRefund;

// =========================================================================
// 5. ALL COMPANY TRANSACTIONS (AUDIT TRAIL)
// =========================================================================

exports.getAllTransactions = async (req, res) => {
  try {
    const { limit = 150, status, search } = req.query;
    const query = {};

    if (status && status !== "all") {
      query.status = status.toLowerCase().trim();
    }

    if (search) {
      const q = String(search).trim();
      query.$or = [
        { reference: { $regex: q, $options: "i" } },
        { transactionId: { $regex: q, $options: "i" } },
        { recipient: { $regex: q, $options: "i" } },
        { "details.phone": { $regex: q, $options: "i" } },
      ];
    }

    const transactions = await Transaction.find(query)
      .populate("user", "name firstName surname phone email role lga state")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: transactions.length,
      transactions,
      data: transactions,
    });
  } catch (error) {
    console.error("getAllTransactions Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve transactions.",
      error: error.message,
    });
  }
};

// =========================================================================
// 6. DATA PACKAGES MATRIX (GET ALL, CREATE, UPDATE, DELETE)
// =========================================================================

exports.getAllDataPlans = async (req, res) => {
  try {
    if (!DataPlan) {
      return res.status(200).json({ success: true, count: 0, data: [], plans: [] });
    }
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
    if (!DataPlan) {
      return res.status(500).json({ success: false, message: "DataPlan model not loaded." });
    }
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
// 7. FINANCIAL DISPATCH: CREDIT, DEBIT & DIRECT OVERRIDE REFUNDS
// =========================================================================

exports.adjustUserWallet = async (req, res) => {
  try {
    const { userId, targetUserId, amount, reason, actionType } = req.body;
    const identifier = userId || targetUserId;
    const numericAmount = Number(amount);
    const superAdminId = req.user?._id || req.user?.id;
    const action = String(actionType || "credit").toLowerCase();

    if (!identifier || isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Provide a valid user identifier (Phone, Email, or ID) and positive numeric amount.",
      });
    }

    const user = await findUserByIdentifier(identifier);

    if (!user) {
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
    user.balance = newBal;
    await user.save({ validateBeforeSave: false });

    const ref = `SUPER-ADJ-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: user._id,
      userId: user._id,
      transactionId: `TXN-SUPER-${Date.now()}`,
      reference: ref,
      type: action === "credit" ? "superadmin_credit" : "superadmin_debit",
      category: action === "credit" ? "CREDIT" : "DEBIT",
      amount: numericAmount,
      oldBalance: oldBal,
      newBalance: newBal,
      status: "success",
      details: `Admin ${action.toUpperCase()}: ${reason || "Direct wallet balance adjustment"}`,
      requestedBy: superAdminId,
    });

    if (Activity && superAdminId) {
      await Activity.create({
        user: superAdminId,
        staffId: superAdminId,
        actorRole: "SUPERADMIN",
        action: action === "credit" ? "SUPERADMIN_WALLET_CREDIT" : "SUPERADMIN_WALLET_DEBIT",
        category: "FINANCIAL",
        details: `Admin performed ${action.toUpperCase()} of ₦${numericAmount.toLocaleString()} on user ${user.phone || user.email}. Reason: ${reason || "Manual balance override"}`,
        targetUser: user._id,
      }).catch(() => {});
    }

    await sendNotification(
      user._id,
      action === "credit" ? "Wallet Credited by Admin" : "Wallet Debited by Admin",
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
    console.error("adjustUserWallet Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to adjust target user wallet balance.",
      error: error.message,
    });
  }
};

// =========================================================================
// 8. ROLE MANAGEMENT & SECURITY OVERRIDES
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
      "field_supervisor",
      "leader",
      "state_manager",
      "super_leader",
      "national_sales_director",
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
    await user.save({ validateBeforeSave: false });

    if (Activity && superAdminId) {
      await Activity.create({
        user: superAdminId,
        staffId: superAdminId,
        actorRole: "SUPERADMIN",
        action: "USER_ROLE_PROMOTED_OR_DEMOTED",
        category: "ADMIN_CONTROL",
        details: `Changed role of user ${user.phone || user.email} from ${String(previousRole).toUpperCase()} to ${normalizedRole.toUpperCase()}`,
        targetUser: user._id,
      }).catch(() => {});
    }

    await sendNotification(
      user._id,
      "Account Role Updated",
      `Your platform account role has been updated from ${String(previousRole).toUpperCase()} to ${normalizedRole.toUpperCase()}.`,
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

    await user.save({ validateBeforeSave: false });

    if (Activity && superAdminId) {
      await Activity.create({
        user: superAdminId,
        staffId: superAdminId,
        actorRole: "SUPERADMIN",
        action: "SECURITY_CREDENTIALS_OVERRIDDEN",
        category: "SECURITY",
        details: `Force-reset credentials for ${user.phone || user.email}`,
        targetUser: user._id,
      }).catch(() => {});
    }

    await sendNotification(
      user._id,
      "Security Credentials Reset",
      "Your account credentials have been updated by administration.",
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
    await user.save({ validateBeforeSave: false });

    if (Activity && superAdminId) {
      await Activity.create({
        user: superAdminId,
        staffId: superAdminId,
        actorRole: "SUPERADMIN",
        action: lockState ? "ACCOUNT_LOCKED" : "ACCOUNT_UNLOCKED",
        category: "SECURITY",
        details: `${lockState ? "Locked" : "Unlocked"} user account ${user.phone || user.email}. Reason: ${reason || "Administrative inspection"}`,
        targetUser: user._id,
      }).catch(() => {});
    }

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
// 9. TARGET ASSIGNMENT (NSD, SM, SUPERVISORS, AGENTS)
// =========================================================================

exports.assignTarget = async (req, res) => {
  try {
    const { supervisorId, userId, agentGoal, dataGoal, airtimeGoal, month } = req.body;
    const targetId = supervisorId || userId;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Staff identifier is required.",
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
    await user.save({ validateBeforeSave: false });

    if (Activity && req.user?._id) {
      await Activity.create({
        user: req.user._id,
        staffId: req.user._id,
        actorRole: "SUPERADMIN",
        action: "SUPERADMIN_ASSIGN_TARGET",
        category: "TARGET",
        details: `Assigned monthly targets (${user.targets.dataGoal}GB Data, ${user.targets.agentGoal} Agents) to ${user.phone || user.email}`,
        targetUser: user._id,
      }).catch(() => {});
    }

    await sendNotification(
      user._id,
      "Monthly Targets Assigned",
      `Your performance quota for ${user.targets.currentMonth || "this month"} is set: ${user.targets.dataGoal}GB Data & ${user.targets.agentGoal} Agents goal.`,
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
// 10. BROADCAST NOTIFICATIONS & MARKETING DISPATCH
// =========================================================================

exports.broadcastNotification = async (req, res) => {
  try {
    const { title, message, body, audience = "all", recipientId, targetUserId, category = "ADMIN_BROADCAST" } = req.body;
    const superAdminId = req.user?._id || req.user?.id;

    const finalTitle = String(title || "").trim();
    const finalMessage = String(message || body || "").trim();
    const targetSingle = recipientId || targetUserId;

    if (!finalTitle || !finalMessage) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Title and Message are required.",
      });
    }

    const notifObj = {
      title: finalTitle,
      message: finalMessage,
      category: String(category).toUpperCase(),
      date: new Date(),
      createdAt: new Date(),
      isRead: false,
      read: false,
    };

    if (audience === "single" || (targetSingle && audience !== "all")) {
      const user = await findUserByIdentifier(targetSingle);
      if (!user) {
        return res.status(404).json({
          success: false,
          status: "failed",
          message: `Target user account not found (${targetSingle}).`,
        });
      }

      if (!user.notifications) user.notifications = [];
      user.notifications.unshift(notifObj);
      if (user.notifications.length > 100) user.notifications = user.notifications.slice(0, 100);
      await user.save({ validateBeforeSave: false });

      if (Notification) {
        await Notification.create({
          recipient: user._id,
          user: user._id,
          title: finalTitle,
          message: finalMessage,
          category: String(category).toUpperCase(),
          isBroadcast: false,
          target: "specific_users",
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        status: "success",
        message: `Notification delivered directly to ${user.name || user.phone}.`,
        targetUser: user.phone || user.email,
      });
    }

    let userFilter = { isSuspended: { $ne: true } };
    let targetLabel = "All Users";

    if (audience === "agents") {
      userFilter.role = "agent";
      targetLabel = "All Agents";
    } else if (audience === "supervisors") {
      userFilter.role = { $in: ["supervisor", "field_supervisor"] };
      targetLabel = "All Supervisors";
    } else if (audience === "state_managers" || audience === "scm") {
      userFilter.role = { $in: ["state_manager", "leader"] };
      targetLabel = "All State Managers (SCM/SM)";
    } else if (audience === "nsd") {
      userFilter.role = { $in: ["national_sales_director", "super_leader"] };
      targetLabel = "All National Sales Directors (NSD)";
    } else if (audience === "users") {
      userFilter.role = "user";
      targetLabel = "All Customers";
    }

    if (Notification) {
      await Notification.create({
        title: finalTitle,
        message: finalMessage,
        category: String(category).toUpperCase(),
        target: audience === "all" ? "all" : audience,
        targetRole: audience === "all" ? undefined : audience,
        isBroadcast: true,
      }).catch(() => {});
    }

    const updateResult = await User.updateMany(
      userFilter,
      {
        $push: {
          notifications: {
            $each: [notifObj],
            $position: 0,
            $slice: 100,
          },
        },
      }
    );

    if (Activity && superAdminId) {
      await Activity.create({
        user: superAdminId,
        staffId: superAdminId,
        actorRole: "SUPERADMIN",
        action: "BROADCAST_NOTIFICATION_DISPATCHED",
        category: "COMMUNICATION",
        details: `Dispatched "${finalTitle}" to [${targetLabel}]. Reached ${updateResult.modifiedCount} accounts.`,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Notification successfully dispatched to ${targetLabel} (${updateResult.modifiedCount} accounts).`,
      dispatchedCount: updateResult.modifiedCount,
      audience: targetLabel,
    });
  } catch (error) {
    console.error("broadcastNotification Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to dispatch notification.",
      error: error.message,
    });
  }
};

exports.dispatchDataBundle = async (req, res) => {
  try {
    const { network, planCode, price, recipients, sendToAllUsers } = req.body;

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

    if (Activity && req.user?._id) {
      await Activity.create({
        user: req.user._id,
        staffId: req.user._id,
        actorRole: "SUPERADMIN",
        action: "BULK_DATA_CAMPAIGN_DISPATCHED",
        category: "VTU",
        details: `Dispatched campaign ${network.toUpperCase()} ${planCode} (₦${price}) to ${targetPhones.length} recipient numbers`,
        targetUser: null,
      }).catch(() => {});
    }

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
// 11. GLOBAL PRICING & TARIFF ENGINE OVERRIDES
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
    const agentPriceNum = agentPrice !== undefined ? Number(agentPrice) : priceNum;
    const costPriceNum = costPrice !== undefined ? Number(costPrice) : 0;

    let updatedDoc = null;

    if (category.includes("nimc") || category.includes("nin")) {
      if (NIMCPrice) {
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
      }
    } else if (category.includes("bvn")) {
      if (BVNPrice) {
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
      }
    } else if (category.includes("data")) {
      if (DataPlan) {
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
      }
    }

    if (Activity && req.user?._id) {
      await Activity.create({
        user: req.user._id,
        staffId: req.user._id,
        actorRole: "SUPERADMIN",
        action: "GLOBAL_PRICING_UPDATED",
        category: "ADMIN_CONTROL",
        details: `Updated tariff [${key}] - User: ₦${priceNum}, Agent: ₦${agentPriceNum}, Cost: ₦${costPriceNum}`,
      }).catch(() => {});
    }

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
// 12. FORENSIC AUDIT EXPUNGING
// =========================================================================

exports.expungeSystemAuditLogs = async (req, res) => {
  try {
    const { retentionDays } = req.body;
    const days = parseInt(retentionDays, 10) || 90;

    const thresholdDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deleteResult = Activity
      ? await Activity.deleteMany({ createdAt: { $lt: thresholdDate } })
      : { deletedCount: 0 };

    if (Activity && req.user?._id) {
      await Activity.create({
        user: req.user._id,
        staffId: req.user._id,
        actorRole: "SUPERADMIN",
        action: "AUDIT_TRAIL_EXPUNGED",
        category: "SYSTEM",
        details: `Expunged ${deleteResult.deletedCount} activity records older than ${days} days`,
      }).catch(() => {});
    }

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