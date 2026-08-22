const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

// ==========================================
// 1. GET USER TRANSACTIONS (Domin Customer App/Web)
// ==========================================
exports.getUserTransactions = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
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
      total,
      page,
      pages: Math.ceil(total / limit),
      transactions,
    });
  } catch (error) {
    console.error("getUserTransactions error:", error);
    return res.status(500).json({
      success: false,
      message: "An kasa loda bayanan transactions.",
      error: error.message,
    });
  }
};

// ==========================================
// 2. GET ALL TRANSACTIONS (Domin Admin Dashboard)
// ==========================================
exports.getAllTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
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
        { details: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate("user", "name email phone role walletBalance")
        .populate("refundedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      transactions,
    });
  } catch (error) {
    console.error("getAllTransactions error:", error);
    return res.status(500).json({
      success: false,
      message: "An kasa loda dukkan transactions.",
      error: error.message,
    });
  }
};

// ==========================================
// 3. GET SINGLE TRANSACTION BY ID / REFERENCE
// ==========================================
exports.getTransactionDetails = async (req, res) => {
  try {
    const { identifier } = req.params;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      query = { _id: identifier };
    } else {
      query = {
        $or: [{ reference: identifier }, { transactionId: identifier }],
      };
    }

    const txn = await Transaction.findOne(query)
      .populate("user", "name email phone role walletBalance")
      .populate("refundedBy", "name email");

    if (!txn) {
      return res.status(404).json({
        success: false,
        message: "Ba a samu wannan transaction din ba.",
      });
    }

    return res.status(200).json({
      success: true,
      transaction: txn,
    });
  } catch (error) {
    console.error("getTransactionDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Kuskure wajen duba bayanan transaction.",
      error: error.message,
    });
  }
};

// ==========================================
// 4. REFUND TRANSACTION (Mayar wa User Kudinsa)
// ==========================================
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
        message: "Dole ne a bada reference ko transactionId.",
      });
    }

    const searchQuery = reference ? { reference } : { transactionId };
    const txn = await Transaction.findOne(searchQuery).session(session);

    if (!txn) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Ba a samu wannan transaction din ba.",
      });
    }

    // Tabbatar da cewa ba a taba mayar da kudin a baya ba
    if (txn.status === "refunded" || txn.status === "failed") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "An riga an mayar da kudin wannan transaction din ko kuma ya gaza a baya.",
      });
    }

    const user = await User.findById(txn.user).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Ba a samu asusun mai amfani da wannan transaction din ba.",
      });
    }

    const refundAmount = Number(txn.amount);
    const oldBalance = Number(user.walletBalance || 0);
    const newBalance = oldBalance + refundAmount;

    // 1. Mayar da kudin cikin Wallet din User
    user.walletBalance = newBalance;
    await user.save({ session });

    // 2. Canza status din tsohon transaction din zuwa "refunded"
    txn.status = "refunded";
    txn.refundReason = reason || "Airtime/Data delivery failed on GSM Gateway";
    txn.refundedAt = new Date();
    txn.refundedBy = adminId;
    await txn.save({ session });

    // 3. Kirkirar sabon Log na REFUND domin tarihin kudi (Audit Trail)
    const refundRef = `REF-${Date.now()}`;
    const refundLog = new Transaction({
      user: user._id,
      transactionId: `TXN-${Date.now()}`,
      type: "refund",
      amount: refundAmount,
      oldBalance,
      newBalance,
      phoneNumber: txn.phoneNumber,
      provider: txn.provider,
      status: "success",
      reference: refundRef,
      details: `Refund na Naira ₦${refundAmount} domin ${txn.type.toUpperCase()} (${txn.reference || txn.transactionId}) da bai shiga ba.`,
      refundReason: reason || "Admin Manual Refund",
      requestedBy: adminId,
    });

    await refundLog.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `An mayar da Naira ₦${refundAmount} cikin asusun ${user.phone || user.email} cikin nasara.`,
      refundReference: refundRef,
      updatedBalance: newBalance,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("refundTransaction error:", error);
    return res.status(500).json({
      success: false,
      message: "Kuskure wajen mayar da kudin.",
      error: error.message,
    });
  }
};

// ==========================================
// 5. GET TRANSACTION SUMMARY / STATS (Admin)
// ==========================================
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
      formattedStats.totalVolume += item.totalAmount;
      formattedStats.totalCount += item.count;

      if (item._id === "success") {
        formattedStats.successfulAmount = item.totalAmount;
        formattedStats.successfulCount = item.count;
      } else if (item._id === "failed") {
        formattedStats.failedAmount = item.totalAmount;
        formattedStats.failedCount = item.count;
      } else if (item._id === "refunded") {
        formattedStats.refundedAmount = item.totalAmount;
        formattedStats.refundedCount = item.count;
      } else if (item._id === "pending" || item._id === "processing") {
        formattedStats.pendingCount += item.count;
      }
    });

    return res.status(200).json({
      success: true,
      stats: formattedStats,
    });
  } catch (error) {
    console.error("getTransactionStats error:", error);
    return res.status(500).json({
      success: false,
      message: "Kuskure wajen lissafin kididdigar transactions.",
      error: error.message,
    });
  }
};