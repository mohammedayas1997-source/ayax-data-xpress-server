const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const NIMCRequest = require("../models/NIMCRequest");
const BVNRequest = require("../models/BVNRequest");
const SupportRequest = require("../models/SupportRequest");
const NIMCPrice = require("../models/NIMCPrice");
const BVNPrice = require("../models/BVNPrice");

// Helper for Real-Time In-App Notifications
const sendNotification = async (userId, title, message, category = "SYSTEM") => {
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
    console.error("In-App Notification Dispatch Error:", error.message);
  }
};

// =========================================================================
// 1. DASHBOARD OVERVIEW & ANALYTICS
// =========================================================================

/**
 * @desc    Get complete metrics, revenue, wallet totals, and platform stats
 * @route   GET /api/v1/admin/dashboard-stats
 * @access  Private (Admin / SuperAdmin / Customer Care)
 */
const getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalAgents,
      totalSupervisors,
      totalTransactions,
      pendingRefunds,
      revenueAggregation,
      pendingNIMC,
      pendingBVN,
      walletAggregation,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "agent" }),
      User.countDocuments({ role: "supervisor" }),
      Transaction.countDocuments(),
      Transaction.countDocuments({
        status: { $in: ["pending-refund", "failed", "pending"] },
      }),
      Transaction.aggregate([
        { $match: { status: { $in: ["success", "completed"] } } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
      ]),
      NIMCRequest.countDocuments({ status: "pending" }),
      BVNRequest.countDocuments({ status: "pending" }),
      User.aggregate([
        {
          $group: {
            _id: null,
            totalWalletLiabilities: {
              $sum: { $ifNull: ["$walletBalance", "$balance", 0] },
            },
          },
        },
      ]),
    ]);

    const totalRevenue = revenueAggregation[0]?.totalRevenue || 0;
    const totalWalletLiabilities = walletAggregation[0]?.totalWalletLiabilities || 0;

    return res.status(200).json({
      success: true,
      status: "success",
      stats: {
        totalUsers,
        totalAgents,
        totalSupervisors,
        totalTransactions,
        pendingRefunds,
        totalRevenue,
        pendingNIMC,
        pendingBVN,
        totalWalletLiabilities,
      },
    });
  } catch (error) {
    console.error("getDashboardStats Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to compile admin dashboard statistics.",
      error: error.message,
    });
  }
};

// =========================================================================
// 2. TRANSACTION MANAGEMENT & AUDIT LOGS
// =========================================================================

/**
 * @desc    Get all transactions with pagination and query filtering
 * @route   GET /api/v1/admin/transactions
 * @access  Private (Admin / SuperAdmin)
 */
const getAllTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 100;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.type) filter.type = req.query.type.toLowerCase();
    if (req.query.status) filter.status = req.query.status.toLowerCase();
    if (req.query.provider) filter.provider = { $regex: req.query.provider, $options: "i" };
    if (req.query.search) {
      const search = req.query.search.trim();
      filter.$or = [
        { reference: { $regex: search, $options: "i" } },
        { transactionId: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { meterNumber: { $regex: search, $options: "i" } },
        { nin: { $regex: search, $options: "i" } },
        { details: { $regex: search, $options: "i" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate("user", "surname firstName name fullName phone email role walletBalance")
        .populate("refundedBy", "surname firstName name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      status: "success",
      total,
      count: transactions.length,
      page,
      pages: Math.ceil(total / limit),
      data: transactions,
      transactions,
    });
  } catch (error) {
    console.error("getAllTransactions Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve transaction records.",
      error: error.message,
    });
  }
};

// =========================================================================
// 3. USER, AGENT & SUPERVISOR CONTROLS
// =========================================================================

/**
 * @desc    Get all users across the platform
 * @route   GET /api/v1/admin/users
 * @access  Private (Admin / SuperAdmin)
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("-password -pin -transactionPin")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: users.length,
      data: users,
      users,
    });
  } catch (error) {
    console.error("getAllUsers Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to fetch user directory.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all registered Supervisors
 * @route   GET /api/v1/admin/supervisors
 * @access  Private (Admin / SuperAdmin)
 */
const getSupervisors = async (req, res) => {
  try {
    const supervisors = await User.find({ role: "supervisor" })
      .select("-password -pin")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: supervisors.length,
      data: supervisors,
      supervisors,
    });
  } catch (error) {
    console.error("getSupervisors Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve supervisors.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all registered Agents
 * @route   GET /api/v1/admin/agents
 * @access  Private (Admin / SuperAdmin)
 */
const getAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" })
      .select("-password -pin")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: agents.length,
      data: agents,
      agents,
    });
  } catch (error) {
    console.error("getAgents Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve agents.",
      error: error.message,
    });
  }
};

/**
 * @desc    Assign monthly performance targets to supervisors
 * @route   POST /api/v1/admin/assign-target
 * @access  Private (Admin / SuperAdmin)
 */
const assignTarget = async (req, res) => {
  try {
    const { supervisorId, agentGoal, dataGoal, month } = req.body;
    const supervisor = await User.findById(supervisorId);

    if (!supervisor || supervisor.role !== "supervisor") {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Designated supervisor account not found.",
      });
    }

    supervisor.targets = {
      agentGoal: Number(agentGoal || 0),
      dataGoal: Number(dataGoal || 0),
      currentMonth: month || new Date().toLocaleString("default", { month: "long" }),
      assignedAt: new Date(),
    };
    supervisor.markModified("targets");
    await supervisor.save();

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      action: "ASSIGN_TARGET",
      category: "ADMIN_CONTROL",
      details: `Assigned monthly targets (Agents: ${agentGoal}, Data: ${dataGoal}GB) to supervisor ${supervisor.phone || supervisor.email}`,
      targetUser: supervisor._id,
    }).catch(() => {});

    await sendNotification(
      supervisor._id,
      "Monthly Target Assigned 🎯",
      `New monthly performance targets have been assigned to your profile: Agent Goal: ${agentGoal}, Data Goal: ${dataGoal}GB.`,
      "SYSTEM"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Monthly performance target assigned successfully.",
      data: supervisor.targets,
    });
  } catch (error) {
    console.error("assignTarget Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to assign targets.",
      error: error.message,
    });
  }
};

/**
 * @desc    Toggle user suspension or active status
 * @route   PATCH /api/v1/admin/suspend-user/:id
 * @access  Private (Admin / SuperAdmin)
 */
const suspendUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found.",
      });
    }

    const isCurrentlySuspended = user.isSuspended || user.status === "suspended";
    const nextSuspendedState = !isCurrentlySuspended;

    user.isSuspended = nextSuspendedState;
    user.status = nextSuspendedState ? "suspended" : "active";
    await user.save();

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      action: nextSuspendedState ? "USER_SUSPENDED" : "USER_UNSUSPENDED",
      category: "SECURITY",
      details: `User ${user.phone || user.email} account state changed to ${user.status.toUpperCase()}`,
      targetUser: user._id,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      status: "success",
      message: `User account is now ${user.status}.`,
      isSuspended: user.isSuspended,
      accountStatus: user.status,
    });
  } catch (error) {
    console.error("suspendUser Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error altering user activation state.",
      error: error.message,
    });
  }
};

// =========================================================================
// 4. IDENTITY SERVICES (NIMC & BVN OVERSIGHT)
// =========================================================================

/**
 * @desc    Get all NIMC applications and modifications
 * @route   GET /api/v1/admin/nimc/requests
 * @access  Private (Admin / SuperAdmin / Customer Care)
 */
const getAllNIMCRequests = async (req, res) => {
  try {
    const requests = await NIMCRequest.find()
      .populate("user", "surname firstName fullName phone email walletBalance")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: requests.length,
      data: requests,
      requests,
    });
  } catch (error) {
    console.error("getAllNIMCRequests Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve NIMC requests.",
      error: error.message,
    });
  }
};

/**
 * @desc    Manually approve NIMC verification/modification request
 * @route   PATCH /api/v1/admin/nimc/approve/:id
 * @access  Private (Admin / SuperAdmin / Customer Care)
 */
const approveRequest = async (req, res) => {
  try {
    const { adminNote, slipUrl, pdfUrl } = req.body;
    const request = await NIMCRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "NIMC request record not found.",
      });
    }

    request.status = "completed";
    request.resolvedAt = new Date();
    if (adminNote) request.adminComment = adminNote;
    if (slipUrl || pdfUrl) {
      request.slipUrl = slipUrl || pdfUrl;
      request.pdfUrl = pdfUrl || slipUrl;
    }
    request.processedBy = req.user._id || req.user.id;
    await request.save();

    if (request.reference) {
      await Transaction.findOneAndUpdate(
        { reference: request.reference },
        {
          status: "success",
          slipUrl: request.slipUrl,
          details: `Manual approval completed by administrative staff`,
        }
      );
    }

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      action: "NIMC_REQUEST_APPROVED",
      category: "IDENTITY",
      details: `Approved NIMC request ID ${request.ninNumber || request._id}`,
      targetUser: request.user,
    }).catch(() => {});

    await sendNotification(
      request.user,
      "NIMC Request Approved 📄",
      `Your verification request for NIN (${request.ninNumber || "Application"}) has been completed. You can view/download your slip in Application History.`,
      "NIN_SERVICE"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "NIMC request approved and result generated successfully.",
      data: request,
    });
  } catch (error) {
    console.error("approveRequest Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error approving NIMC request.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all BVN verification requests
 * @route   GET /api/v1/admin/bvn/requests
 * @access  Private (Admin / SuperAdmin / Customer Care)
 */
const getAllBVNRequests = async (req, res) => {
  try {
    const requests = await BVNRequest.find()
      .populate("user", "surname firstName fullName phone email walletBalance")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: requests.length,
      data: requests,
      requests,
    });
  } catch (error) {
    console.error("getAllBVNRequests Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve BVN verification requests.",
      error: error.message,
    });
  }
};

/**
 * @desc    Manually approve BVN verification request
 * @route   PATCH /api/v1/admin/bvn/approve/:id
 * @access  Private (Admin / SuperAdmin / Customer Care)
 */
const approveBVNRequest = async (req, res) => {
  try {
    const { adminNote, slipUrl, pdfUrl } = req.body;
    const request = await BVNRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "BVN request record not found.",
      });
    }

    request.status = "completed";
    request.resolvedAt = new Date();
    if (adminNote) request.adminComment = adminNote;
    if (slipUrl || pdfUrl) {
      request.slipUrl = slipUrl || pdfUrl;
      request.pdfUrl = pdfUrl || slipUrl;
    }
    request.processedBy = req.user._id || req.user.id;
    await request.save();

    if (request.reference) {
      await Transaction.findOneAndUpdate(
        { reference: request.reference },
        {
          status: "success",
          slipUrl: request.slipUrl,
          details: `Manual BVN approval completed by administrative staff`,
        }
      );
    }

    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      action: "BVN_REQUEST_APPROVED",
      category: "IDENTITY",
      details: `Approved BVN request ID ${request.bvnNumber || request._id}`,
      targetUser: request.user,
    }).catch(() => {});

    await sendNotification(
      request.user,
      "BVN Verification Approved 📄",
      `Your verification request for BVN (${request.bvnNumber || "Application"}) has been completed successfully.`,
      "BVN_SERVICE"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN request approved and updated successfully.",
      data: request,
    });
  } catch (error) {
    console.error("approveBVNRequest Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error approving BVN request.",
      error: error.message,
    });
  }
};

// =========================================================================
// 5. REFUND DISPATCH & FINANCIAL CONTROLS
// =========================================================================

/**
 * @desc    Approve and credit manual refund back to user wallet
 * @route   POST /api/v1/admin/refunds/approve/:id
 * @access  Private (Admin / SuperAdmin)
 */
const approveRefund = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user?._id || req.user?.id;

    const transaction = await Transaction.findById(id).session(session);
    if (!transaction) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Transaction record not found.",
      });
    }

    if (transaction.status === "refunded" || transaction.isRefunded) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "This transaction has already been refunded.",
      });
    }

    const user = await User.findById(transaction.user || transaction.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Beneficiary user account not found.",
      });
    }

    const refundAmt = Number(transaction.amount || 0);
    const oldBalance = Number(user.walletBalance ?? user.balance ?? 0);
    const newBalance = Number((oldBalance + refundAmt).toFixed(2));

    // 1. Credit wallet balance
    user.walletBalance = newBalance;
    if (user.balance !== undefined) user.balance = newBalance;
    await user.save({ session });

    // 2. Update transaction status
    transaction.status = "refunded";
    transaction.isRefunded = true;
    transaction.refundReason = reason || "Approved manual administrator reversal";
    transaction.refundedBy = adminId;
    transaction.refundedAt = new Date();
    await transaction.save({ session });

    // 3. Create independent Refund Ledger Entry
    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const refundLog = new Transaction({
      user: user._id,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "CREDIT",
      amount: refundAmt,
      oldBalance,
      newBalance,
      phoneNumber: transaction.phoneNumber || null,
      meterNumber: transaction.meterNumber || null,
      nin: transaction.nin || null,
      provider: transaction.provider || "ADMIN_REFUND",
      status: "success",
      details: `Refund of ₦${refundAmt.toLocaleString()} for ${transaction.type.toUpperCase()} (${transaction.reference || transaction.transactionId})`,
      refundReason: reason || "Manual Administrator Approval",
      requestedBy: adminId,
    });
    await refundLog.save({ session });

    await session.commitTransaction();
    session.endSession();

    await Activity.create({
      user: adminId,
      staffId: adminId,
      action: "REFUND_APPROVED",
      category: "FINANCIAL",
      details: `Refunded ₦${refundAmt.toLocaleString()} to user ${user.phone || user.email} for transaction (${transaction.reference})`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Wallet Refund Credited 💰",
      `A refund of ₦${refundAmt.toLocaleString()} has been credited to your wallet balance for transaction (${transaction.reference || transaction.type.toUpperCase()}).`,
      "REFUND"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Refund of ₦${refundAmt.toLocaleString()} processed successfully.`,
      newBalance,
      refundReference: refundRef,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    console.error("approveRefund Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error processing wallet refund.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all failed or pending-refund transactions
 * @route   GET /api/v1/admin/refunds/pending
 * @access  Private (Admin / SuperAdmin / Customer Care)
 */
const getPendingRefunds = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      $or: [
        { status: { $in: ["pending-refund", "failed"] }, isRefunded: { $ne: true } },
        { status: "failed", isRefunded: false },
      ],
    })
      .populate("user", "surname firstName fullName phone email walletBalance")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: transactions.length,
      data: transactions,
      transactions,
    });
  } catch (error) {
    console.error("getPendingRefunds Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve pending refund items.",
      error: error.message,
    });
  }
};

// =========================================================================
// 6. SUPPORT AUDIT LOGS & DYNAMIC SERVICE PRICING
// =========================================================================

/**
 * @desc    Get complete administrator and staff audit trail
 * @route   GET /api/v1/admin/support-activities
 * @access  Private (Admin / SuperAdmin)
 */
const getSupportActivities = async (req, res) => {
  try {
    const activities = await Activity.find()
      .populate("user", "surname firstName fullName email name phone role")
      .populate("staffId", "surname firstName fullName email name phone role")
      .populate("targetUser", "surname firstName fullName phone email name")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: activities.length,
      data: activities,
      activities,
    });
  } catch (error) {
    console.error("getSupportActivities Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to fetch support activity logs.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get current active NIMC pricing configuration
 * @route   GET /api/v1/admin/pricing/nimc
 * @access  Public / Private
 */
const getNIMCPrice = async (req, res) => {
  try {
    const prices = await NIMCPrice.find().sort({ serviceId: 1 }).lean();
    return res.status(200).json({
      success: true,
      status: "success",
      count: prices.length,
      data: prices.length === 1 ? prices[0] : prices,
      prices,
    });
  } catch (error) {
    console.error("getNIMCPrice Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error fetching NIMC pricing.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get current active BVN pricing configuration
 * @route   GET /api/v1/admin/pricing/bvn
 * @access  Public / Private
 */
const getBVNPrice = async (req, res) => {
  try {
    const prices = await BVNPrice.find().sort({ serviceId: 1 }).lean();
    return res.status(200).json({
      success: true,
      status: "success",
      count: prices.length,
      data: prices.length === 1 ? prices[0] : prices,
      prices,
    });
  } catch (error) {
    console.error("getBVNPrice Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error fetching BVN pricing.",
      error: error.message,
    });
  }
};

module.exports = {
  getDashboardStats,
  getAllTransactions,
  assignTarget,
  getSupervisors,
  getAgents,
  getAllUsers,
  suspendUser,
  getAllNIMCRequests,
  approveRequest,
  getAllBVNRequests,
  approveBVNRequest,
  approveRefund,
  getPendingRefunds,
  getSupportActivities,
  getNIMCPrice,
  getBVNPrice,
};