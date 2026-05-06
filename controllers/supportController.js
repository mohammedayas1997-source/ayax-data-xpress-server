const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const BVNRequest = require("../models/BVNRequest");
const NIMCRequest = require("../models/NIMCRequest");

// 1. Search for any user by Phone or Email
exports.searchUser = async (req, res) => {
  try {
    const { identifier } = req.params;
    const user = await User.findOne({
      $or: [{ phone: identifier }, { email: identifier }],
    }).select("-password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const history = await Transaction.find({
      $or: [{ user: user._id }, { userId: user._id }],
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json({
      success: true,
      data: { profile: user, recentTransactions: history },
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Search failed", error: error.message });
  }
};

// 2. Get User Transaction History
exports.getUserTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const transactions = await Transaction.find({
      $or: [{ user: userId }, { userId: userId }],
    }).sort({ createdAt: -1 });

    res
      .status(200)
      .json({ success: true, count: transactions.length, data: transactions });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching history",
      error: error.message,
    });
  }
};

// 3. Initiate a refund request
exports.requestRefund = async (req, res) => {
  try {
    const { transactionId, reason } = req.body;
    if (!transactionId || !reason) {
      return res
        .status(400)
        .json({ success: false, message: "Provide ID and reason" });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    transaction.status = "pending-refund";
    transaction.refundReason = reason;
    transaction.requestedBy = req.user._id;
    await transaction.save();

    await Activity.create({
      staffId: req.user._id,
      action: "REFUND_REQUEST",
      details: `Refund for TX: ${transactionId}`,
      targetUser: transaction.user || transaction.userId,
    });

    res.status(200).json({ success: true, message: "Refund request logged" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Refund failed", error: error.message });
  }
};

// 4. Get Refund Status
exports.getRefundStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = await Transaction.findById(transactionId).select(
      "status refundReason createdAt",
    );

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * TRACE SERVICE REQUEST (Expanded for All Services)
 * Tracing for BVN, NIMC, Data, Airtime, Cable, and Electricity
 */
exports.traceServiceRequest = async (req, res) => {
  try {
    const { type, identifier } = req.params;
    let result;

    // Identity Services Tracing
    if (type === "bvn") {
      result = await BVNRequest.find({
        $or: [
          { bvnNumber: identifier },
          { phoneNumber: identifier },
          { transactionId: identifier },
        ],
      }).populate("user", "firstName surname email phone");
    } else if (type === "nimc") {
      result = await NIMCRequest.find({
        $or: [
          { ninNumber: identifier },
          { phoneNumber: identifier },
          { transactionId: identifier },
        ],
      }).populate("user", "firstName surname email phone");
    }
    // VTU, Data, Cable, & Electricity Tracing
    else if (["data", "vtu", "cable", "utility"].includes(type)) {
      result = await Transaction.find({
        category: type,
        $or: [
          { reference: identifier },
          { "details.recipient": identifier }, // Phone number or Meter number
          { "details.smartCard": identifier }, // Cable TV card number
          { "details.phone": identifier },
        ],
      }).populate("user", "firstName surname email phone");
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid service type" });
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No ${type.toUpperCase()} records found for this identifier`,
      });
    }

    res.status(200).json({
      success: true,
      service: type.toUpperCase(),
      count: result.length,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error tracing service request",
      error: error.message,
    });
  }
};
