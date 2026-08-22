const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const NIMCRequest = require("../models/NIMCRequest");
const BVNRequest = require("../models/BVNRequest");
const SupportRequest = require("../models/SupportRequest");
const NIMCPrice = require("../models/NIMCPrice");
const BVNPrice = require("../models/BVNPrice");

const sendNotification = async (userId, title, message) => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.push({ title, message, date: new Date(), isRead: false });
      await user.save();
    }
  } catch (error) {
    console.error("Notification failed:", error);
  }
};

// --- DASHBOARD & STATS ---
const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const pendingRefunds = await Transaction.countDocuments({ status: { $in: ["pending-refund", "failed"] } });
    const successfulTransactions = await Transaction.find({ status: "success" });
    const totalRevenue = successfulTransactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

    res.status(200).json({
      success: true,
      stats: { totalUsers, totalTransactions, pendingRefunds, totalRevenue },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- TRANSACTIONS ---
const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "surname firstName phone email name")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.status(200).json({ success: true, count: transactions.length, data: transactions, transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- SUPERVISORS & AGENTS ---
const assignTarget = async (req, res) => {
  try {
    const { supervisorId, agentGoal, dataGoal, month } = req.body;
    const supervisor = await User.findById(supervisorId);
    if (!supervisor || supervisor.role !== "supervisor") {
      return res.status(404).json({ success: false, message: "Supervisor not found" });
    }
    supervisor.targets = {
      agentGoal: Number(agentGoal || 0),
      dataGoal: Number(dataGoal || 0),
      currentMonth: month || new Date().toLocaleString("default", { month: "long" }),
    };
    supervisor.markModified("targets");
    await supervisor.save();

    res.status(200).json({ success: true, message: "Target assigned successfully", data: supervisor.targets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSupervisors = async (req, res) => {
  try {
    const supervisors = await User.find({ role: "supervisor" }).select("-password").sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: supervisors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" }).select("-password").sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: agents });
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

const suspendUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.status = user.status === "suspended" ? "active" : "suspended";
    await user.save();
    res.status(200).json({ success: true, message: `User status: ${user.status}`, status: user.status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- NIMC & BVN ---
const getAllNIMCRequests = async (req, res) => {
  try {
    const requests = await NIMCRequest.find().populate("user", "surname firstName phone email").sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: requests.length, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveRequest = async (req, res) => {
  try {
    const request = await NIMCRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found" });
    request.status = "completed";
    await request.save();
    await sendNotification(request.user, "NIMC Completed", "Your NIMC request has been approved.");
    res.status(200).json({ success: true, message: "NIMC request approved" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllBVNRequests = async (req, res) => {
  try {
    const requests = await BVNRequest.find().populate("user", "surname firstName phone email").sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: requests.length, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const approveBVNRequest = async (req, res) => {
  try {
    const request = await BVNRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found" });
    request.status = "completed";
    await request.save();
    await sendNotification(request.user, "BVN Completed", "Your BVN request has been approved.");
    res.status(200).json({ success: true, message: "BVN request approved" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- REFUNDS & SUPPORT ---
const approveRefund = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(400).json({ success: false, message: "Transaction not found" });

    const user = await User.findById(transaction.user || transaction.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const refundAmt = Number(transaction.amount);
    user.walletBalance = (user.walletBalance || user.balance || 0) + refundAmt;
    if (user.balance !== undefined) user.balance = user.walletBalance;

    transaction.status = "refunded";
    transaction.refundedBy = req.user._id;
    transaction.refundedAt = Date.now();
    await Promise.all([user.save(), transaction.save()]);

    await Activity.create({
      staffId: req.user._id,
      action: "REFUND_APPROVED",
      details: `Refunded ₦${refundAmt} for ${transaction.reference}`,
      targetUser: user._id,
    });

    res.status(200).json({ success: true, message: "Refund processed successfully", newBalance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getPendingRefunds = async (req, res) => {
  try {
    const transactions = await Transaction.find({ status: { $in: ["pending-refund", "failed"] } })
      .populate("user", "surname firstName phone email")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSupportActivities = async (req, res) => {
  try {
    const activities = await Activity.find()
      .populate("staffId", "surname firstName email name")
      .populate("targetUser", "surname firstName phone name")
      .sort({ createdAt: -1 })
      .limit(1000);
    res.status(200).json({ success: true, data: activities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

const getBVNPrice = async (req, res) => {
  try {
    const price = await BVNPrice.findOne().sort({ updatedAt: -1 });
    res.status(200).json({ success: true, data: price });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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