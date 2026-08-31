const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

// Dynamic imports to safeguard against missing models
let Activity;
try {
  Activity = require("../models/Activity");
} catch (e) {
  Activity = null;
}

let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  Notification = null;
}

// Helper for strict, direct-to-user in-app notifications
const sendNotification = async (userId, title, message, category = "SYSTEM") => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title,
        message,
        category: category.toUpperCase(),
        date: new Date(),
        createdAt: new Date(),
        isRead: false,
        read: false,
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
        title,
        message,
        category: category.toUpperCase(),
        type: category.toLowerCase(),
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        isRead: false,
        read: false,
        createdAt: new Date(),
      }).catch(() => {});
    }
  } catch (error) {
    console.error("Notification delivery error:", error.message);
  }
};

/**
 * 1. GET USER TRANSACTIONS (Matches Frontend: HistoryScreen.js)
 * @route GET /api/v1/transactions/my-history
 * @route GET /api/v1/transactions/history
 * @route GET /api/v1/transactions/my-transactions
 * @route GET /api/v1/vtu/history
 * @access Private (User)
 */
exports.getUserTransactions = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const userPhone = req.user?.phone || "";
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 100;
    const skip = (page - 1) * limit;

    // Strict User-Level Isolation
    const baseQuery = {
      $or: [
        { user: userId },
        { userId: userId },
        ...(userPhone ? [{ recipient: userPhone }, { phoneNumber: userPhone }, { "details.phone": userPhone }] : []),
      ],
    };

    // Category / Service Filter
    if (req.query.category && req.query.category !== "all") {
      const cat = String(req.query.category).toUpperCase().trim();
      if (cat === "AIRTIME") {
        baseQuery.$and = [
          ...(baseQuery.$and || []),
          { $or: [{ type: "airtime" }, { type: "vtu" }, { service: /airtime/i }, { category: "AIRTIME" }] },
        ];
      } else if (cat === "DATA") {
        baseQuery.$and = [
          ...(baseQuery.$and || []),
          { $or: [{ type: "data" }, { service: /data/i }, { category: "DATA" }] },
        ];
      } else if (cat === "WALLET") {
        baseQuery.$and = [
          ...(baseQuery.$and || []),
          { $or: [{ type: "wallet_funding" }, { type: "deposit" }, { type: "refund" }, { category: "WALLET" }, { category: "CREDIT" }] },
        ];
      } else if (cat === "UTILITIES") {
        baseQuery.$and = [
          ...(baseQuery.$and || []),
          { $or: [{ type: "electricity" }, { type: "cable" }, { category: "UTILITIES" }] },
        ];
      } else if (cat === "IDENTITY") {
        baseQuery.$and = [
          ...(baseQuery.$and || []),
          { $or: [{ type: "nimc" }, { type: "bvn" }, { type: "nin" }, { category: "IDENTITY" }] },
        ];
      }
    }

    if (req.query.type && req.query.type !== "all") {
      baseQuery.type = req.query.type.toLowerCase();
    }

    if (req.query.status && req.query.status !== "all") {
      baseQuery.status = req.query.status.toLowerCase();
    }

    // Real-Time Search Query Filter
    if (req.query.search) {
      const q = String(req.query.search).trim();
      const searchRegex = new RegExp(q, "i");
      baseQuery.$and = [
        ...(baseQuery.$and || []),
        {
          $or: [
            { reference: searchRegex },
            { transactionId: searchRegex },
            { recipient: searchRegex },
            { phoneNumber: searchRegex },
            { meterNumber: searchRegex },
            { nin: searchRegex },
            { bvn: searchRegex },
            { description: searchRegex },
            { service: searchRegex },
            { details: searchRegex },
            ...(!isNaN(Number(q)) ? [{ amount: Number(q) }] : []),
          ],
        },
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(baseQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(baseQuery),
    ]);

    return res.status(200).json({
      success: true,
      status: "success",
      total,
      count: transactions.length,
      page,
      pages: Math.ceil(total / limit),
      data: transactions,
      history: transactions,
      transactions,
    });
  } catch (error) {
    console.error("getUserTransactions error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve transaction history.",
      error: error.message,
    });
  }
};

exports.getMyTransactions = exports.getUserTransactions;

/**
 * 2. GET ALL TRANSACTIONS (Admin & Global Search)
 * @route GET /api/v1/transactions/admin/all
 * @route GET /api/v1/transactions/all
 * @access Private (Admin / Superadmin)
 */
exports.getAllTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.type && req.query.type !== "all") {
      filter.type = req.query.type.toLowerCase();
    }

    if (req.query.status && req.query.status !== "all") {
      filter.status = req.query.status.toLowerCase();
    }

    if (req.query.provider) {
      filter.provider = { $regex: req.query.provider, $options: "i" };
    }

    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      filter.$or = [
        { reference: { $regex: searchTerm, $options: "i" } },
        { transactionId: { $regex: searchTerm, $options: "i" } },
        { recipient: { $regex: searchTerm, $options: "i" } },
        { phoneNumber: { $regex: searchTerm, $options: "i" } },
        { meterNumber: { $regex: searchTerm, $options: "i" } },
        { nin: { $regex: searchTerm, $options: "i" } },
        { bvn: { $regex: searchTerm, $options: "i" } },
        { details: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate("user", "surname firstName name fullName email phone role walletBalance balance lga state")
        .populate("refundedBy", "surname firstName name fullName email")
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
    console.error("getAllTransactions error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve global transaction records.",
      error: error.message,
    });
  }
};

/**
 * 3. GET SINGLE TRANSACTION DETAILS BY ID / REFERENCE
 * @route GET /api/v1/transactions/:identifier
 * @access Private
 */
exports.getTransactionDetails = async (req, res) => {
  try {
    const { identifier } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      query = { _id: identifier };
    } else {
      query = {
        $or: [
          { reference: identifier },
          { transactionId: identifier },
          { apiReference: identifier },
        ],
      };
    }

    const txn = await Transaction.findOne(query)
      .populate("user", "surname firstName name fullName email phone role walletBalance balance lga state")
      .populate("refundedBy", "surname firstName name fullName email");

    if (!txn) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Transaction record not found.",
      });
    }

    return res.status(200).json({
      success: true,
      status: "success",
      data: txn,
      transaction: txn,
    });
  } catch (error) {
    console.error("getTransactionDetails error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error fetching transaction details.",
      error: error.message,
    });
  }
};

/**
 * 4. ADMIN MANUAL TRANSACTION REFUND (ISOLATED TO BENEFICIARY)
 * @route POST /api/v1/transactions/refund
 * @access Private (Admin / Superadmin)
 */
exports.refundTransaction = async (req, res) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch (e) {
    session = null;
  }

  try {
    const { reference, transactionId, reason } = req.body;
    const adminId = req.user?._id || req.user?.id;

    if (!reference && !transactionId) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide either transaction reference or transactionId.",
      });
    }

    const searchQuery = reference ? { reference } : { transactionId };
    const txn = await Transaction.findOne(searchQuery).session(session);

    if (!txn) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Transaction record not found.",
      });
    }

    if (txn.status === "refunded" || txn.isRefunded) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "This transaction has already been refunded.",
      });
    }

    const user = await User.findById(txn.user || txn.userId).session(session);
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

    const refundAmount = Number(txn.amount || 0);
    const oldBalance = Number(user.walletBalance ?? user.balance ?? 0);
    const newBalance = Number((oldBalance + refundAmount).toFixed(2));

    // 1. Credit funds strictly back into user's wallet
    user.walletBalance = newBalance;
    if (user.balance !== undefined) user.balance = newBalance;
    await user.save(session ? { session } : undefined);

    // 2. Mark original transaction as refunded
    txn.status = "refunded";
    txn.isRefunded = true;
    txn.refundReason = reason || "Administrative reversal on failed service delivery";
    txn.refundedAt = new Date();
    txn.refundedBy = adminId;
    await txn.save(session ? { session } : undefined);

    // 3. Create permanent refund audit ledger record
    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const refundLog = new Transaction({
      user: user._id,
      userId: user._id,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "CREDIT",
      amount: refundAmount,
      oldBalance,
      newBalance,
      recipient: txn.recipient || user.phone,
      phoneNumber: txn.phoneNumber || user.phone,
      meterNumber: txn.meterNumber || null,
      nin: txn.nin || null,
      provider: txn.provider || "SYSTEM_REFUND",
      status: "success",
      details: `Refund of ₦${refundAmount.toLocaleString()} for ${String(txn.type || txn.service || "Service").toUpperCase()} (${txn.reference || txn.transactionId})`,
      refundReason: reason || "Manual Admin Refund",
      requestedBy: adminId,
    });
    await refundLog.save(session ? { session } : undefined);

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    // 4. Log Admin Activity & Dispatch Notification (Targeted to this user only)
    if (Activity && adminId) {
      await Activity.create({
        user: adminId,
        staffId: adminId,
        action: "MANUAL_REFUND_PROCESSED",
        category: "FINANCIAL",
        details: `Refunded ₦${refundAmount.toLocaleString()} strictly to user ${user.phone || user.email} for transaction (${txn.reference})`,
        targetUser: user._id,
      }).catch(() => {});
    }

    await sendNotification(
      user._id,
      "Wallet Refund Credited 💳",
      `A refund of ₦${refundAmount.toLocaleString()} has been credited to your wallet for transaction (${txn.reference || String(txn.type).toUpperCase()}). Reason: ${reason || "Service adjustment"}`,
      "REFUND"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully refunded ₦${refundAmount.toLocaleString()} exclusively to ${user.phone || user.email}.`,
      refundReference: refundRef,
      updatedBalance: newBalance,
    });
  } catch (error) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("refundTransaction error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while processing refund.",
      error: error.message,
    });
  }
};

/**
 * 5. GET TRANSACTION METRICS & STATISTICAL OVERVIEW
 * @route GET /api/v1/transactions/admin/stats
 * @access Private (Admin / Superadmin)
 */
exports.getTransactionStats = async (req, res) => {
  try {
    const stats = await Transaction.aggregate([
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const formattedStats = {
      totalVolume: 0,
      totalCount: 0,
      successfulAmount: 0,
      successfulCount: 0,
      failedAmount: 0,
      failedCount: 0,
      refundedAmount: 0,
      refundedCount: 0,
      pendingCount: 0,
    };

    stats.forEach((item) => {
      const statusKey = String(item._id).toLowerCase();
      formattedStats.totalVolume += item.totalAmount;
      formattedStats.totalCount += item.count;

      if (statusKey === "success" || statusKey === "completed") {
        formattedStats.successfulAmount += item.totalAmount;
        formattedStats.successfulCount += item.count;
      } else if (statusKey === "failed") {
        formattedStats.failedAmount += item.totalAmount;
        formattedStats.failedCount += item.count;
      } else if (statusKey === "refunded") {
        formattedStats.refundedAmount += item.totalAmount;
        formattedStats.refundedCount += item.count;
      } else if (statusKey === "pending" || statusKey === "pending-refund" || statusKey === "processing") {
        formattedStats.pendingCount += item.count;
      }
    });

    return res.status(200).json({
      success: true,
      status: "success",
      stats: formattedStats,
      data: formattedStats,
    });
  } catch (error) {
    console.error("getTransactionStats error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to calculate transaction analytics.",
      error: error.message,
    });
  }
};