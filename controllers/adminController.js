const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");

// GYARA: Wadannan sunayen dole su dace da files din da ka lissafa
const NIMCRequest = require("../models/NIMCRequest");
const BVNRequest = require("../models/BVNRequest");

// Idan kana bukatar su, ga yadda zaka kira NIMCPrice da BVNPrice
const NIMCPrice = require("../models/NIMCPrice");
const BVNPrice = require("../models/BVNPrice");
// @desc    Assign monthly targets to a Supervisor
const assignTarget = async (req, res) => {
  try {
    const { supervisorId, agentGoal, dataGoal, month } = req.body;
    if (!supervisorId)
      return res
        .status(400)
        .json({ success: false, message: "Supervisor ID is required" });

    const supervisor = await User.findById(supervisorId);
    if (!supervisor || supervisor.role !== "supervisor") {
      return res
        .status(404)
        .json({ success: false, message: "Supervisor not found" });
    }

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

// --- NIMC MANAGEMENT FUNCTIONS ---

// @desc    Get all NIMC requests
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

// @desc    Update NIMC to Processing
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

// @desc    Approve NIMC Request
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

// --- BVN MANAGEMENT FUNCTIONS ---

// @desc    Get all BVN requests
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

// @desc    Update BVN Status (Processing)
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

// @desc    Approve BVN Request
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

// --- CORE ADMIN FUNCTIONS ---

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
    if (!transaction || transaction.status !== "pending-refund") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid refund request" });
    }

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
};
