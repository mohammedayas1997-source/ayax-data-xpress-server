const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const NIMCRequest = require("../models/NIMCRequest");
const BVNRequest = require("../models/BVNRequest");
const SupportRequest = require("../models/SupportRequest");
const NIMCPrice = require("../models/NIMCPrice");
const BVNPrice = require("../models/BVNPrice");
const bcrypt = require("bcryptjs");
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

// --- FUNCTIONS ---

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
      .populate("user", "surname firstName phone")
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
      { new: true },
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
    res.status(200).json({ success: true, message: "NIMC request approved" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllBVNRequests = async (req, res) => {
  try {
    const requests = await BVNRequest.find()
      .populate("user", "surname firstName phone")
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
      { new: true },
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
    user.walletBalance = (user.walletBalance || 0) + Number(transaction.amount);
    transaction.status = "refunded";
    transaction.approvedBy = req.user._id;
    transaction.resolvedAt = Date.now();
    await Promise.all([user.save(), transaction.save()]);
    await Activity.create({
      staffId: req.user._id,
      action: "REFUND_APPROVED",
      details: `Refunded ${transaction.amount}`,
      targetUser: user._id,
    });
    res.status(200).json({ success: true, message: "Refund processed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: users });
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
      { new: true, runValidators: true },
    );
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, data: user });
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
    res.status(200).json({ success: true, message: `Status: ${user.status}` });
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
      .populate("user", "surname firstName phone")
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
      { new: true },
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res
      .status(200)
      .json({ success: true, message: `Wallet ${status} successfully`, user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

const debitUser = async (req, res) => {
  const { userId, amount, reason } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.balance < amount)
      return res.status(400).json({ message: "Insufficient balance" });
    user.balance -= amount;
    user.transactions.push({
      type: "debit",
      amount,
      status: "success",
      description: `Admin Debit: ${reason}`,
      date: new Date(),
    });
    await user.save();
    res.status(200).json({
      success: true,
      message: `₦${amount} debited`,
      newBalance: user.balance,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

const trackTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const user = await User.findOne({
      "transactions.transactionId": transactionId,
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Transaction ID not found" });
    const transaction = user.transactions.find(
      (t) => t.transactionId === transactionId,
    );
    res.status(200).json({
      success: true,
      userData: { id: user._id, name: user.name, phone: user.phone },
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
      requestedBy: req.user.id,
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
      .populate("userId", "name phone")
      .populate("requestedBy", "name")
      .sort("-createdAt");
    res.status(200).json({ success: true, requests });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Error fetching requests" });
  }
};

const handleSupportRequest = async (req, res) => {
  try {
    const { requestId, action, adminNote } = req.body;
    const request = await SupportRequest.findById(requestId).populate("userId");
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (action === "resolve") {
      const user = request.userId;
      const transaction = user.transactions.find(
        (t) => t.transactionId === request.transactionId,
      );
      if (transaction && transaction.status !== "refunded") {
        user.balance += transaction.amount;
        transaction.status = "refunded";
        request.status = "resolved";
        await sendNotification(
          user._id,
          "Wallet Refunded",
          `Your transaction of ₦${transaction.amount} has been refunded.`,
        );
        await user.save();
      }
    } else if (action === "reject") {
      request.status = "rejected";
      await sendNotification(
        request.userId._id,
        "Support Request Update",
        `Declined. Note: ${adminNote}`,
      );
    }
    await request.save();
    res
      .status(200)
      .json({ success: true, message: `Action '${action}' completed.` });
  } catch (error) {
    res.status(500).json({ message: "Process failed", error: error.message });
  }
};
const createSupervisor = async (req, res) => {
  try {
    const { firstName, surname, email, phone, password } = req.body;

    if (!firstName || !surname || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    // CHECK EXISTING USER
    const existingUser = await User.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Supervisor already exists",
      });
    }

    // HASH PASSWORD
    const hashedPassword = await bcrypt.hash(password, 10);

    const supervisor = await User.create({
      firstName,
      surname,
      name: `${firstName} ${surname}`,
      email: email.toLowerCase().trim(),
      phone,
      password: hashedPassword,
      role: "supervisor",
      status: "active",
      walletBalance: 0,
    });

    res.status(201).json({
      success: true,
      message: "Supervisor created successfully",
      data: {
        id: supervisor._id,
        name: supervisor.name,
        email: supervisor.email,
        role: supervisor.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
// --- FINAL EXPORT ---
// Mun hada kowane function a nan domin kar a samu "undefined" a routes
module.exports = {
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
  updateUserRole,
  suspendUser,
  getSupportActivities,
  getPendingRefunds,
  toggleWalletStatus,
  debitUser,
  trackTransaction,
  requestAdminFix,
  getSupportRequests,
  handleSupportRequest,
  createSupervisor,
};
