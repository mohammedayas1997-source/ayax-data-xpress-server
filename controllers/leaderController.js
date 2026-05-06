const User = require("../models/User");
const TargetHistory = require("../models/TargetHistory");
const mongoose = require("mongoose");

// @desc    Leader assigns target to a Supervisor
exports.assignSupervisorTarget = async (req, res) => {
  try {
    const { supervisorId, dataGoal, agentGoal, month } = req.body;

    if (!supervisorId) {
      return res
        .status(400)
        .json({ success: false, message: "Please provide supervisorId" });
    }

    const supervisor = await User.findOne({
      _id: supervisorId,
      role: "supervisor",
    });

    if (!supervisor) {
      return res
        .status(404)
        .json({ success: false, message: "Supervisor not found" });
    }

    // Amfani da "obj || {}" don gujewa "undefined" errors
    const currentTargets = supervisor.targets || {};

    supervisor.targets = {
      dataGoal: Number(dataGoal) || currentTargets.dataGoal || 0,
      agentGoal: Number(agentGoal) || currentTargets.agentGoal || 0,
      currentMonth:
        month || new Date().toLocaleString("en-US", { month: "long" }),
    };

    supervisor.assignedLeader = req.user._id;
    supervisor.markModified("targets");
    await supervisor.save();

    res.status(200).json({
      success: true,
      message: "Target assigned successfully",
      targets: supervisor.targets,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Download Report as CSV (Simple Version to avoid json2csv crash)
exports.downloadSupervisorReport = async (req, res) => {
  try {
    const { supervisorId } = req.params;
    const history = await TargetHistory.find({ assignedTo: supervisorId })
      .sort("-createdAt")
      .lean();

    if (!history || history.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No history found" });
    }

    // Idan baka bukatar CSV yanzu-yanzu, turo JSON kawai don mu ga server ta tashi
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Toggle Supervisor Status
exports.toggleSupervisorStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.supervisorId);
    if (!user)
      return res.status(404).json({ success: false, message: "Not found" });

    user.isSuspended = !user.isSuspended;
    await user.save();
    res
      .status(200)
      .json({ success: true, message: `Status: ${user.isSuspended}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create New Supervisor
exports.createNewSupervisor = async (req, res) => {
  try {
    const newSup = await User.create({
      ...req.body,
      role: "supervisor",
      assignedLeader: req.user._id,
    });
    res.status(201).json({ success: true, data: newSup });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Get Detailed Stats for Leader Dashboard
exports.getLeaderDashboard = async (req, res) => {
  try {
    const supervisors = await User.find({
      role: "supervisor",
      assignedLeader: req.user._id,
    }).lean();
    const supDetails = await Promise.all(
      supervisors.map(async (sup) => {
        const agentsCount = await User.countDocuments({
          role: "agent",
          assignedSupervisor: sup._id,
        });
        return {
          id: sup._id,
          name: sup.name,
          teamSize: agentsCount,
          targets: sup.targets || { dataGoal: 0, agentGoal: 0 },
        };
      }),
    );
    res.status(200).json({ success: true, supervisors: supDetails });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Assign Agent to Supervisor
exports.assignAgentToSupervisor = async (req, res) => {
  try {
    const agent = await User.findOneAndUpdate(
      { _id: req.body.agentId, role: "agent" },
      { assignedSupervisor: req.body.supervisorId },
      { new: true },
    );
    if (!agent)
      return res
        .status(404)
        .json({ success: false, message: "Agent not found" });
    res.status(200).json({ success: true, message: "Assigned" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get All Agents
exports.getAllAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" })
      .populate("assignedSupervisor", "name")
      .lean();
    res.status(200).json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
