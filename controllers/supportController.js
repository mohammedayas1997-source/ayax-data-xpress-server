const User = require("../models/User");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");

// SAFE DYNAMIC MODELS LOADER
let Activity;
try {
  Activity = require("../models/Activity");
} catch (e) {
  Activity = null;
}

let BVNRequest;
try {
  BVNRequest = require("../models/BVNRequest");
} catch (e) {
  BVNRequest = null;
}

let NIMCRequest;
try {
  NIMCRequest = require("../models/NIMCRequest");
} catch (e) {
  NIMCRequest = null;
}

let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  Notification = null;
}

/**
 * @desc    Search for any user by Phone, Email, Reference, or NIN/BVN
 * @route   GET /api/v1/support/search-user/:identifier ko /api/v1/admin/search-user/:identifier
 * @access  Private/Admin/Support
 */
exports.searchUser = async (req, res) => {
  try {
    const { identifier } = req.params;
    if (!identifier) {
      return res.status(400).json({ success: false, message: "Please provide search identifier" });
    }

    const clean = identifier.trim();
    const cleanLower = clean.toLowerCase();

    // 1. Duba User a Database ta hanyoyi daban-daban
    let user = await User.findOne({
      $or: [
        { phone: clean },
        { phone: clean.replace(/^0/, "+234") },
        { phone: clean.replace(/^\+234/, "0") },
        { email: new RegExp(`^${cleanLower}$`, "i") },
        { accountNumber: clean },
        { bvn: clean },
        { nin: clean },
      ],
    }).select("-password").lean();

    // 2. Idan ba a samu User kai tsaye ba, duba ko Reference ce aka bayar a Transaction
    if (!user) {
      const tx = await Transaction.findOne({
        $or: [
          { reference: clean },
          { transactionId: clean },
          { _id: mongoose.Types.ObjectId.isValid(clean) ? clean : null },
        ],
      }).lean();

      if (tx && (tx.user || tx.userId)) {
        user = await User.findById(tx.user || tx.userId).select("-password").lean();
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user account found matching this query.",
      });
    }

    // 3. Kwaso Tarihin Hada-hadar User din
    const history = await Transaction.find({
      $or: [
        { user: user._id },
        { userId: user._id },
        { "details.phone": user.phone },
        { recipient: user.phone },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        profile: user,
        recentTransactions: history,
      },
    });
  } catch (error) {
    console.error("Search User Diagnostic Error:", error);
    return res.status(500).json({
      success: false,
      message: "Search diagnostic failed",
      error: error.message,
    });
  }
};

/**
 * @desc    Get User Transaction History
 * @route   GET /api/v1/support/user-transactions/:userId ko /api/v1/admin/user-transactions/:userId
 * @access  Private/Admin/Support
 */
exports.getUserTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid User ID format" });
    }

    const transactions = await Transaction.find({
      $or: [{ user: userId }, { userId: userId }],
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error("Get User Transactions Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching history",
      error: error.message,
    });
  }
};

/**
 * @desc    Get Live Company Transactions Feed (Real-Time 5s Telemetry)
 * @route   GET /api/v1/support/live-transactions
 * @access  Private/Admin/Support
 */
exports.getLiveCompanyTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "name firstName surname email phone lga state")
      .sort({ createdAt: -1 })
      .limit(35)
      .lean();

    return res.status(200).json({
      success: true,
      count: transactions.length,
      transactions: transactions,
      data: transactions,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Initiate a refund / Escalate to SuperAdmin
 * @route   POST /api/v1/support/refund ko /api/v1/support/escalate-refund
 * @access  Private/Admin/Support
 */
exports.requestRefund = async (req, res) => {
  try {
    const { transactionId, reference, reason, phoneOrEmail, amount } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: "Provide refund justification reason" });
    }

    let targetTransaction = null;

    if (transactionId && mongoose.Types.ObjectId.isValid(transactionId)) {
      targetTransaction = await Transaction.findById(transactionId);
    } else if (reference) {
      targetTransaction = await Transaction.findOne({
        $or: [{ reference }, { transactionId: reference }],
      });
    }

    let targetUserId = targetTransaction?.user || targetTransaction?.userId;

    if (!targetUserId && phoneOrEmail) {
      const u = await User.findOne({
        $or: [{ phone: phoneOrEmail.trim() }, { email: phoneOrEmail.trim().toLowerCase() }],
      });
      if (u) targetUserId = u._id;
    }

    if (targetTransaction) {
      targetTransaction.status = "pending-refund";
      targetTransaction.refundReason = reason;
      targetTransaction.requestedBy = req.user?._id;
      await targetTransaction.save();
    }

    // Tura wa SuperAdmin Sanarwa ta Musamman
    if (Notification) {
      await Notification.create({
        title: "DISPUTE / REFUND ESCALATION",
        message: `Dispute logged: ${reason} | Amount: ₦${amount || targetTransaction?.amount || 0} | Ref: ${reference || targetTransaction?.reference || "N/A"}`,
        category: "REFUND",
        priority: "HIGH",
        targetRole: "superadmin",
        isBroadcast: false,
        createdAt: new Date(),
      }).catch(() => {});
    }

    if (Activity && req.user?._id) {
      await Activity.create({
        staffId: req.user._id,
        user: req.user._id,
        action: "REFUND_REQUEST",
        details: `Dispute logged for TX: ${reference || transactionId || "Manual"}. Reason: ${reason}`,
        targetUser: targetUserId || null,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: "Refund dispute dispatched successfully to SuperAdmin queue.",
      data: targetTransaction,
    });
  } catch (error) {
    console.error("Request Refund Error:", error);
    return res.status(500).json({
      success: false,
      message: "Refund escalation failed",
      error: error.message,
    });
  }
};

/**
 * @desc    TRACE SERVICE REQUEST (BVN, NIMC, Data, VTU, Bills)
 * @route   GET /api/v1/support/trace/:type/:identifier ko /api/v1/admin/trace/:type/:identifier
 * @access  Private/Admin/Support
 */
exports.traceServiceRequest = async (req, res) => {
  try {
    const { type, identifier } = req.params;

    if (!type || !identifier) {
      return res.status(400).json({ success: false, message: "Provide service type and identifier" });
    }

    const serviceType = type.toLowerCase().trim();
    const cleanId = identifier.trim();
    let result = [];

    // 1. Identity Services: BVN
    if (serviceType === "bvn" && BVNRequest) {
      result = await BVNRequest.find({
        $or: [
          { bvnNumber: cleanId },
          { phoneNumber: cleanId },
          { transactionId: cleanId },
          { reference: cleanId },
        ],
      })
        .populate("user", "surname firstName name email phone")
        .lean();
    }

    // 2. Identity Services: NIMC
    else if ((serviceType === "nimc" || serviceType === "nin") && NIMCRequest) {
      result = await NIMCRequest.find({
        $or: [
          { ninNumber: cleanId },
          { phoneNumber: cleanId },
          { transactionId: cleanId },
          { reference: cleanId },
        ],
      })
        .populate("user", "surname firstName name email phone")
        .lean();
    }

    // 3. VTU, Data, Cable, Electricity, ko dukkan Services a Transaction Model
    if (result.length === 0) {
      const searchRegex = new RegExp(cleanId, "i");
      result = await Transaction.find({
        $or: [
          { reference: cleanId },
          { transactionId: cleanId },
          { recipient: cleanId },
          { "details.phone": cleanId },
          { "details.recipient": cleanId },
          { "details.smartCard": cleanId },
          { "details.meterNo": cleanId },
          { description: searchRegex },
        ],
      })
        .populate("user", "surname firstName name email phone")
        .sort({ createdAt: -1 })
        .limit(25)
        .lean();
    }

    return res.status(200).json({
      success: true,
      service: serviceType.toUpperCase(),
      count: result.length,
      data: result,
      results: result,
    });
  } catch (error) {
    console.error("Trace Service Request Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error tracing service request",
      error: error.message,
    });
  }
};