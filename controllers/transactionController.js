const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Activity = require("../models/Activity");

// Helper for real-time in-app notifications
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
    console.error("Notification delivery error:", error.message);
  }
};

/**
 * 1. GET USER TRANSACTIONS (Matches Frontend: HistoryScreen.js)
 * @route GET /api/v1/vtu/history
 * @route GET /api/v1/transactions/my-transactions
 * @access Private (User)
 */
exports.getUserTransactions = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = { user: userId };

    if (req.query.type) {
      filter.type = req.query.type.toLowerCase();
    }

    if (req.query.status) {
      filter.status = req.query.status.toLowerCase();
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
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

/**
 * 2. GET ALL TRANSACTIONS (Admin Dashboard & Global Search)
 * @route GET /api/v1/transactions/admin/all
 * @access Private (Admin / Superadmin)
 */
exports.getAllTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.type) {
      filter.type = req.query.type.toLowerCase();
    }

    if (req.query.status) {
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
        { phoneNumber: { $regex: searchTerm, $options: "i" } },
        { meterNumber: { $regex: searchTerm, $options: "i" } },
        { nin: { $regex: searchTerm, $options: "i" } },
        { bvn: { $regex: searchTerm, $options: "i" } },
        { details: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate("user", "surname firstName name fullName email phone role walletBalance balance")
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
        $or: [{ reference: identifier }, { transactionId: identifier }, { apiReference: identifier }],
      };
    }

    const txn = await Transaction.findOne(query)
      .populate("user", "surname firstName name fullName email phone role walletBalance balance")
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
 * 4. ADMIN MANUAL TRANSACTION REFUND
 * @route POST /api/v1/transactions/refund
 * @access Private (Admin / Superadmin)
 */
exports.refundTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference, transactionId, reason } = req.body;
    const adminId = req.user?._id || req.user?.id;

    if (!reference && !transactionId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide either reference or transactionId.",
      });
    }

    const searchQuery = reference ? { reference } : { transactionId };
    const txn = await Transaction.findOne(searchQuery).session(session);

    if (!txn) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Transaction record not found.",
      });
    }

    if (txn.status === "refunded" || txn.isRefunded) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "This transaction has already been refunded.",
      });
    }

    const user = await User.findById(txn.user).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Beneficiary user account not found.",
      });
    }

    const refundAmount = Number(txn.amount || 0);
    const oldBalance = Number(user.walletBalance ?? user.balance ?? 0);
    const newBalance = Number((oldBalance + refundAmount).toFixed(2));

    // 1. Credit funds back into user's wallet
    user.walletBalance = newBalance;
    if (user.balance !== undefined) user.balance = newBalance;
    await user.save({ session });

    // 2. Mark original transaction as refunded
    txn.status = "refunded";
    txn.isRefunded = true;
    txn.refundReason = reason || "Administrative reversal on failed service delivery";
    txn.refundedAt = new Date();
    txn.refundedBy = adminId;
    await txn.save({ session });

    // 3. Create independent Refund Ledger Audit Trail
    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const refundLog = new Transaction({
      user: user._id,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "CREDIT",
      amount: refundAmount,
      oldBalance,
      newBalance,
      phoneNumber: txn.phoneNumber || null,
      meterNumber: txn.meterNumber || null,
      nin: txn.nin || null,
      provider: txn.provider || "SYSTEM_REFUND",
      status: "success",
      details: `Refund of ₦${refundAmount.toLocaleString()} for ${txn.type.toUpperCase()} (${txn.reference || txn.transactionId})`,
      refundReason: reason || "Manual Admin Refund",
      requestedBy: adminId,
    });
    await refundLog.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 4. Log Admin Activity & Dispatch Real-Time Notification
    await Activity.create({
      user: adminId,
      staffId: adminId,
      action: "MANUAL_REFUND_PROCESSED",
      category: "FINANCIAL",
      details: `Refunded ₦${refundAmount.toLocaleString()} to user ${user.phone || user.email} for transaction (${txn.reference})`,
      targetUser: user._id,
    }).catch(() => {});

    await sendNotification(
      user._id,
      "Wallet Refund Credited 💰",
      `A refund of ₦${refundAmount.toLocaleString()} has been credited to your wallet for transaction (${txn.reference || txn.type.toUpperCase()}). Reason: ${reason || "Service adjustment"}`,
      "REFUND"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully refunded ₦${refundAmount.toLocaleString()} to ${user.phone || user.email}.`,
      refundReference: refundRef,
      updatedBalance: newBalance,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
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

      if (statusKey === "success" || statusKey === "successful") {
        formattedStats.successfulAmount += item.totalAmount;
        formattedStats.successfulCount += item.count;
      } else if (statusKey === "failed") {
        formattedStats.failedAmount += item.totalAmount;
        formattedStats.failedCount += item.count;
      } else if (statusKey === "refunded") {
        formattedStats.refundedAmount += item.totalAmount;
        formattedStats.refundedCount += item.count;
      } else if (statusKey === "pending" || statusKey === "processing") {
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