const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const BVNRequest = require("../models/BVNRequest");
const NIMCRequest = require("../models/NIMCRequest");
const mongoose = require("mongoose");

/**
 * @desc    Search for any user by Phone or Email
 * @route   GET /api/v1/admin/search-user/:identifier
 * @access  Private/Admin
 */
exports.searchUser = async (req, res) => {
  try {
    const { identifier } = req.params;
    if (!identifier) {
      return res.status(400).json({ success: false, message: "Please provide phone or email identifier" });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    const user = await User.findOne({
      $or: [
        { phone: cleanIdentifier }, 
        { phone: identifier.trim() },
        { email: cleanIdentifier }
      ],
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
      .limit(20)
      .lean();

    res.status(200).json({
      success: true,
      data: { profile: user, recentTransactions: history },
    });
  } catch (error) {
    console.error("Search User Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Search failed", error: error.message });
  }
};

/**
 * @desc    Get User Transaction History
 * @route   GET /api/v1/admin/user-transactions/:userId
 * @access  Private/Admin
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

    res
      .status(200)
      .json({ success: true, count: transactions.length, data: transactions });
  } catch (error) {
    console.error("Get User Transactions Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching history",
      error: error.message,
    });
  }
};

/**
 * @desc    Initiate a refund request
 * @route   POST /api/v1/admin/request-refund
 * @access  Private/Admin
 */
exports.requestRefund = async (req, res) => {
  try {
    const { transactionId, reason } = req.body;
    
    if (!transactionId || !reason) {
      return res
        .status(400)
        .json({ success: false, message: "Provide transaction ID and reason" });
    }

    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return res.status(400).json({ success: false, message: "Invalid Transaction ID format" });
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

    const targetUserId = transaction.user || transaction.userId;

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "REFUND_REQUEST",
      details: `Requested refund for TX: ${transactionId}. Reason: ${reason}`,
      targetUser: targetUserId || null,
    });

    res.status(200).json({ success: true, message: "Refund request logged successfully", data: transaction });
  } catch (error) {
    console.error("Request Refund Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Refund failed", error: error.message });
  }
};

/**
 * @desc    Get Refund Status
 * @route   GET /api/v1/admin/refund-status/:transactionId
 * @access  Private/Admin
 */
exports.getRefundStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return res.status(400).json({ success: false, message: "Invalid Transaction ID format" });
    }

    const transaction = await Transaction.findById(transactionId).select(
      "status refundReason createdAt requestedBy reference amount type",
    );

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    console.error("Get Refund Status Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    TRACE SERVICE REQUEST (Expanded for All Services)
 * @route   GET /api/v1/admin/trace/:type/:identifier
 * @access  Private/Admin
 */
exports.traceServiceRequest = async (req, res) => {
  try {
    const { type, identifier } = req.params;
    let result;

    if (!type || !identifier) {
      return res.status(400).json({ success: false, message: "Provide service type and identifier" });
    }

    const serviceType = type.toLowerCase().trim();
    const cleanIdentifier = identifier.trim();

    // Identity Services Tracing (BVN)
    if (serviceType === "bvn") {
      result = await BVNRequest.find({
        $or: [
          { bvnNumber: cleanIdentifier },
          { phoneNumber: cleanIdentifier },
          { transactionId: cleanIdentifier },
        ],
      })
        .populate("user", "surname firstName email phone")
        .lean();
    } 
    // Identity Services Tracing (NIMC)
    else if (serviceType === "nimc") {
      result = await NIMCRequest.find({
        $or: [
          { ninNumber: cleanIdentifier },
          { phoneNumber: cleanIdentifier },
          { transactionId: cleanIdentifier },
        ],
      })
        .populate("user", "surname firstName email phone")
        .lean();
    }
    // VTU, Data, Cable, Electricity, & Other Transactions
    else if (["data", "vtu", "airtime", "cable", "electricity", "utility"].includes(serviceType)) {
      result = await Transaction.find({
        $or: [
          { type: serviceType },
          { category: serviceType },
        ],
        $and: [
          {
            $or: [
              { reference: cleanIdentifier },
              { transactionId: cleanIdentifier },
              { "details.recipient": cleanIdentifier },
              { "details.smartCard": cleanIdentifier },
              { "details.phone": cleanIdentifier },
              { "details.meterNo": cleanIdentifier },
            ],
          },
        ],
      })
        .populate("user", "surname firstName email phone")
        .lean();
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid service type specified for tracing" });
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No ${serviceType.toUpperCase()} records found for identifier: ${cleanIdentifier}`,
      });
    }

    res.status(200).json({
      success: true,
      service: serviceType.toUpperCase(),
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Trace Service Request Error:", error);
    res.status(500).json({
      success: false,
      message: "Error tracing service request",
      error: error.message,
    });
  }
};