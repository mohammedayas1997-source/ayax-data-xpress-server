const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const NIMCRequest = require("../models/NIMCRequest");
const BVNRequest = require("../models/BVNRequest");
const SupportRequest = require("../models/SupportRequest");
const NIMCPrice = require("../models/NIMCPrice");
const BVNPrice = require("../models/BVNPrice");

// Helper for notifications
const sendNotification = async (userId, title, message) => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.push({
        title,
        message,
        date: new Date(),
        isRead: false,
      });
      await user.save();
    }
  } catch (error) {
    console.error("Notification failed:", error);
  }
};

// --- 1. DASHBOARD & STATS ---
const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const pendingRefunds = await Transaction.countDocuments({
      status: "pending-refund",
    });

    const successfulTransactions = await Transaction.find({
      status: "success",
    });
    const totalRevenue = successfulTransactions.reduce(
      (sum, tx) => sum + (Number(tx.amount) || 0),
      0
    );

    res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalTransactions,
        pendingRefunds,
        totalRevenue,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- 2. TRANSACTIONS ---
const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "surname firstName phone email")
      .sort({ createdAt: -1 })
      .limit(500);

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
      transactions,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- 3. TARGETS & USERS ---
const assignTarget = async (req, res) => {
  try {
    const { supervisorId, agentGoal, dataGoal, month } = req.body;
    if (!supervisorId)
      return res
        .status(400)
        .json({ success: false, message: "Supervisor ID is required" });
    const supervisor = await User.findById(supervisorId);
    if (!supervisor || supervisor.role !== "supervisor")
      return res
        .status(404)
        .json({ success: false, message: "Supervisor not found" });
    const currentTargets = supervisor.targets || {};
    supervisor.targets = {
      agentGoal:
        agentGoal !== undefined
          ? Number(agentGoal)
          : currentTargets.agentGoal || 0,
      dataGoal:
        dataGoal !== undefined
          ? Number(dataGoal)
          : currentTargets.dataGoal || 0,
      currentMonth:
        month ||
        currentTargets.currentMonth ||
        new Date().toLocaleString("default", { month: "long" }),
    };
    supervisor.markModified("targets");
    await supervisor.save();
    res.status(200).json({
      success: true,
      message: "Target assigned successfully",
      data: supervisor.targets,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllNIMCRequests = async (req, res) => {
  try {
    const requests = await NIMCRequest.find()
      .populate("user", "surname firstName phone email")
      .sort({ createdAt: -1 });
    res
      .status(200)
      .json({ success: true, count: requests.length, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateToProcessing = async (req, res) => {
  try {
    const request = await NIMCRequest.findByIdAndUpdate(
      req.params.id,
      { status: "processing" },
      { new: true }
    );
    if (!request)
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    res.status(200).json({
      success: true,
      message: "Status updated to processing",
      data: request,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveRequest = async (req, res) => {
  try {
    const request = await NIMCRequest.findById(req.params.id);
    if (!request)
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    request.status = "completed";
    await request.save();

    await sendNotification(
      request.user,
      "NIMC Request Completed",
      "Your NIMC modification/tracking request has been successfully approved."
    );

    res.status(200).json({ success: true, message: "NIMC request approved" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllBVNRequests = async (req, res) => {
  try {
    const requests = await BVNRequest.find()
      .populate("user", "surname firstName phone email")
      .sort({ createdAt: -1 });
    res
      .status(200)
      .json({ success: true, count: requests.length, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateBVNStatus = async (req, res) => {
  try {
    const request = await BVNRequest.findByIdAndUpdate(
      req.params.id,
      { status: "processing" },
      { new: true }
    );
    if (!request)
      return res
        .status(404)
        .json({ success: false, message: "BVN request not found" });
    res.status(200).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveBVNRequest = async (req, res) => {
  try {
    const request = await BVNRequest.findById(req.params.id);
    if (!request)
      return res
        .status(404)
        .json({ success: false, message: "BVN request not found" });
    request.status = "completed";
    await request.save();

    await sendNotification(
      request.user,
      "BVN Request Completed",
      "Your BVN modification/tracking request has been successfully approved."
    );

    res.status(200).json({ success: true, message: "BVN Request Completed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSupervisors = async (req, res) => {
  try {
    const supervisors = await User.find({ role: "supervisor" })
      .select("-password")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: supervisors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" })
      .select("-password")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveRefund = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction || transaction.status !== "pending-refund")
      return res
        .status(400)
        .json({ success: false, message: "Invalid refund request" });
    const userId = transaction.user || transaction.userId;
    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    user.walletBalance =
      (user.walletBalance || user.balance || 0) + Number(transaction.amount);
    transaction.status = "refunded";
    transaction.approvedBy = req.user._id;
    transaction.resolvedAt = Date.now();
    await Promise.all([user.save(), transaction.save()]);

    await Activity.create({
      staffId: req.user._id,
      action: "REFUND_APPROVED",
      details: `Refunded ₦${transaction.amount}`,
      targetUser: user._id,
    });
    res
      .status(200)
      .json({ success: true, message: "Refund processed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: users, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateUserRole = async (req, res) => {
  try {
    const { userId, role } = req.body;
    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true, runValidators: true }
    ).select("-password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const suspendUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    user.status = user.status === "suspended" ? "active" : "suspended";
    await user.save();
    res.status(200).json({
      success: true,
      message: `User status changed to: ${user.status}`,
      status: user.status,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSupportActivities = async (req, res) => {
  try {
    const activities = await Activity.find()
      .populate("staffId", "surname firstName email")
      .populate("targetUser", "surname firstName phone")
      .sort({ createdAt: -1 })
      .limit(1000);
    res.status(200).json({ success: true, data: activities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPendingRefunds = async (req, res) => {
  try {
    const transactions = await Transaction.find({ status: "pending-refund" })
      .populate("user", "surname firstName phone email")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const toggleWalletStatus = async (req, res) => {
  const { userId, status } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { walletStatus: status },
      { new: true }
    ).select("-password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    res
      .status(200)
      .json({ success: true, message: `Wallet ${status} successfully`, user });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

const creditUser = async (req, res) => {
  const { userId, amount, reason } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const numericAmount = Number(amount);
    user.walletBalance =
      (user.walletBalance || user.balance || 0) + numericAmount;
    if (user.balance !== undefined) user.balance = user.walletBalance;

    if (!user.transactions) user.transactions = [];
    user.transactions.push({
      type: "credit",
      amount: numericAmount,
      status: "success",
      description: `Admin Credit: ${reason || "Manual Funding"}`,
      date: new Date(),
    });

    await user.save();

    await Activity.create({
      staffId: req.user._id,
      action: "USER_CREDITED",
      details: `Credited ₦${numericAmount} to ${user.email}`,
      targetUser: user._id,
    });

    await sendNotification(
      user._id,
      "Wallet Credited",
      `Your account has been credited with ₦${numericAmount}. Reason: ${
        reason || "Admin funding"
      }`
    );

    res.status(200).json({
      success: true,
      message: `₦${numericAmount} credited successfully`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

const debitUser = async (req, res) => {
  const { userId, amount, reason } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const currentBal =
      user.walletBalance !== undefined
        ? user.walletBalance
        : user.balance || 0;
    const numericAmount = Number(amount);

    if (currentBal < numericAmount)
      return res
        .status(400)
        .json({ success: false, message: "Insufficient balance" });

    user.walletBalance = currentBal - numericAmount;
    if (user.balance !== undefined) user.balance = user.walletBalance;

    if (!user.transactions) user.transactions = [];
    user.transactions.push({
      type: "debit",
      amount: numericAmount,
      status: "success",
      description: `Admin Debit: ${reason || "Administrative deduction"}`,
      date: new Date(),
    });

    await user.save();

    await Activity.create({
      staffId: req.user._id,
      action: "USER_DEBITED",
      details: `Debited ₦${numericAmount} from ${user.email}`,
      targetUser: user._id,
    });

    await sendNotification(
      user._id,
      "Wallet Debited",
      `Your account has been debited by ₦${numericAmount}. Reason: ${
        reason || "Admin charge"
      }`
    );

    res.status(200).json({
      success: true,
      message: `₦${numericAmount} debited successfully`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

const trackTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const user = await User.findOne({
      "transactions.transactionId": transactionId,
    });
    if (!user) {
      const globalTx = await Transaction.findOne({ transactionId }).populate(
        "user",
        "surname firstName phone email"
      );
      if (!globalTx) {
        return res
          .status(404)
          .json({ success: false, message: "Transaction ID not found" });
      }
      return res.status(200).json({
        success: true,
        userData: globalTx.user
          ? {
              id: globalTx.user._id,
              name: `${globalTx.user.surname || ""} ${
                globalTx.user.firstName || ""
              }`.trim(),
              phone: globalTx.user.phone,
            }
          : null,
        transaction: globalTx,
      });
    }

    const transaction = user.transactions.find(
      (t) => t.transactionId === transactionId
    );
    res.status(200).json({
      success: true,
      userData: {
        id: user._id,
        name:
          `${user.surname || ""} ${user.firstName || ""}`.trim() || user.name,
        phone: user.phone,
      },
      transaction,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

const requestAdminFix = async (req, res) => {
  try {
    const { transactionId, userId, reason, supportNote } = req.body;
    const newRequest = await SupportRequest.create({
      transactionId,
      userId,
      requestedBy: req.user._id,
      reason,
      supportNote,
    });
    res.status(201).json({
      success: true,
      message: "Issue reported successfully",
      data: newRequest,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to send report",
      error: error.message,
    });
  }
};

const getSupportRequests = async (req, res) => {
  try {
    const requests = await SupportRequest.find()
      .populate("userId", "surname firstName phone email")
      .populate("requestedBy", "surname firstName email")
      .sort("-createdAt");
    res.status(200).json({ success: true, requests });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching requests",
      error: error.message,
    });
  }
};

const handleSupportRequest = async (req, res) => {
  try {
    const { requestId, action, adminNote } = req.body;
    const request = await SupportRequest.findById(requestId).populate("userId");
    if (!request)
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });

    if (action === "resolve") {
      const user = request.userId;
      if (user && user.transactions) {
        const transaction = user.transactions.find(
          (t) => t.transactionId === request.transactionId
        );
        if (transaction && transaction.status !== "refunded") {
          user.walletBalance =
            (user.walletBalance || user.balance || 0) + transaction.amount;
          if (user.balance !== undefined) user.balance = user.walletBalance;
          transaction.status = "refunded";
          await user.save();
        }
      }
      request.status = "resolved";
      request.adminNote = adminNote || "Resolved by admin";
      if (user) {
        await sendNotification(
          user._id,
          "Support Request Resolved",
          `Your support issue regarding transaction ID: ${request.transactionId} has been resolved.`
        );
      }
    } else if (action === "reject") {
      request.status = "rejected";
      request.adminNote = adminNote || "Rejected by admin";
      if (request.userId) {
        await sendNotification(
          request.userId._id,
          "Support Request Update",
          `Your support request was declined. Note: ${
            adminNote || "No reason provided"
          }`
        );
      }
    }
    await request.save();
    res.status(200).json({
      success: true,
      message: `Action '${action}' completed successfully.`,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Process failed", error: error.message });
  }
};

const getNIMCPrice = async (req, res) => {
  try {
    const price = await NIMCPrice.findOne().sort({ updatedAt: -1 });
    res.status(200).json({ success: true, data: price });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateNIMCPrice = async (req, res) => {
  try {
    const { price } = req.body;
    let priceDoc = await NIMCPrice.findOne();
    if (!priceDoc) {
      priceDoc = await NIMCPrice.create({ price });
    } else {
      priceDoc.price = price;
      await priceDoc.save();
    }
    res
      .status(200)
      .json({ success: true, message: "NIMC price updated", data: priceDoc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getBVNPrice = async (req, res) => {
  try {
    const price = await BVNPrice.findOne().sort({ updatedAt: -1 });
    res.status(200).json({ success: true, data: price });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateBVNPrice = async (req, res) => {
  try {
    const { price } = req.body;
    let priceDoc = await BVNPrice.findOne();
    if (!priceDoc) {
      priceDoc = await BVNPrice.create({ price });
    } else {
      priceDoc.price = price;
      await priceDoc.save();
    }
    res
      .status(200)
      .json({ success: true, message: "BVN price updated", data: priceDoc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- FINAL EXPORTS (Aliases included) ---
module.exports = {
  getDashboardStats,
  getStats: getDashboardStats,
  getAdminDashboard: getDashboardStats,
  getAllTransactions,
  getTransactions: getAllTransactions,
  assignTarget,
  getAllNIMCRequests,
  updateToProcessing,
  approveRequest,
  getAllBVNRequests,
  updateBVNStatus,
  approveBVNRequest,
  getSupervisors,
  getAgents,
  approveRefund,
  getAllUsers,
  getUsers: getAllUsers,
  updateUserRole,
  suspendUser,
  getSupportActivities,
  getPendingRefunds,
  toggleWalletStatus,
  creditUser,
  debitUser,
  trackTransaction,
  requestAdminFix,
  getSupportRequests,
  handleSupportRequest,
  getNIMCPrice,
  updateNIMCPrice,
  getBVNPrice,
  updateBVNPrice,
};