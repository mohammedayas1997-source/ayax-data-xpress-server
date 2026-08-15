const User = require("../models/User");
const TargetHistory = require("../models/TargetHistory");
const Activity = require("../models/Activity");
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
    const targetMonth = month || new Date().toLocaleString("en-US", { month: "long" });

    supervisor.targets = {
      dataGoal: Number(dataGoal) || currentTargets.dataGoal || 0,
      agentGoal: Number(agentGoal) || currentTargets.agentGoal || 0,
      currentMonth: targetMonth,
    };

    supervisor.assignedLeader = req.user._id;
    supervisor.markModified("targets");
    await supervisor.save();

    // Adana tarihi a cikin TargetHistory domin bibiya da rahoto
    await TargetHistory.create({
      assignedTo: supervisorId,
      assignedBy: req.user._id,
      dataGoal: Number(dataGoal) || 0,
      agentGoal: Number(agentGoal) || 0,
      month: targetMonth,
    });

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "SUPERVISOR_TARGET_ASSIGNED",
      details: `Assigned targets to supervisor ${supervisor.name} for ${targetMonth}`,
      targetUser: supervisorId,
    });

    res.status(200).json({
      success: true,
      message: "Target assigned successfully",
      targets: supervisor.targets,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Download Report as CSV (Ingantacciyar Hanyar CSV ko JSON)
exports.downloadSupervisorReport = async (req, res) => {
  try {
    const { supervisorId } = req.params;
    const history = await TargetHistory.find({ assignedTo: supervisorId })
      .populate("assignedBy", "name email")
      .sort("-createdAt")
      .lean();

    if (!history || history.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No history found for this supervisor" });
    }

    // Duba ko mai amfani yana son CSV file ko JSON response
    const format = req.query.format;
    if (format === "csv") {
      let csvHeader = "Month,Data Goal,Agent Goal,Assigned At\n";
      let csvRows = history.map(h => 
        `"${h.month}",${h.dataGoal},${h.agentGoal},"${new Date(h.createdAt).toLocaleDateString()}"`
      ).join("\n");
      
      const csvData = csvHeader + csvRows;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=supervisor-report-${supervisorId}.csv`);
      return res.status(200).send(csvData);
    }

    res.status(200).json({ success: true, count: history.length, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Toggle Supervisor Status (Suspend / Unsuspend)
exports.toggleSupervisorStatus = async (req, res) => {
  try {
    const supervisorId = req.params.supervisorId || req.params.id;
    const user = await User.findById(supervisorId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "Supervisor not found" });
    }

    user.isSuspended = !user.isSuspended;
    await user.save();

    await Activity.create({
      staffId: req.user._id,
      action: user.isSuspended ? "SUPERVISOR_SUSPENDED" : "SUPERVISOR_ACTIVATED",
      details: `Changed suspension status for ${user.name} to ${user.isSuspended}`,
      targetUser: user._id,
    });

    res.status(200).json({ 
      success: true, 
      message: `Supervisor status updated successfully`,
      isSuspended: user.isSuspended 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Create New Supervisor
exports.createNewSupervisor = async (req, res) => {
  try {
    const { email, phone, password, firstName, surname, state, lga, address } = req.body;

    if (!email || !phone || !password || !firstName || !surname) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields (firstName, surname, email, phone, password)",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { phone: phone.trim() }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email or phone already exists",
      });
    }

    const newSup = await User.create({
      ...req.body,
      name: `${firstName} ${surname}`,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      role: "supervisor",
      assignedLeader: req.user._id,
    });

    await Activity.create({
      staffId: req.user._id,
      action: "SUPERVISOR_CREATED",
      details: `Created new supervisor account for ${newSup.name}`,
      targetUser: newSup._id,
    });

    res.status(201).json({ success: true, message: "Supervisor created successfully", data: newSup });
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
          email: sup.email,
          phone: sup.phone,
          isSuspended: sup.isSuspended || false,
          teamSize: agentsCount,
          targets: sup.targets || { dataGoal: 0, agentGoal: 0, currentMonth: "" },
        };
      }),
    );

    res.status(200).json({ 
      success: true, 
      totalSupervisors: supervisors.length,
      supervisors: supDetails 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Assign Agent to Supervisor
exports.assignAgentToSupervisor = async (req, res) => {
  try {
    const { agentId, supervisorId } = req.body;

    if (!agentId || !supervisorId) {
      return res.status(400).json({ success: false, message: "Provide agentId and supervisorId" });
    }

    const agent = await User.findOneAndUpdate(
      { _id: agentId, role: "agent" },
      { assignedSupervisor: supervisorId },
      { new: true },
    );

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    res.status(200).json({ success: true, message: "Agent assigned to supervisor successfully", agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get All Agents
exports.getAllAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" })
      .populate("assignedSupervisor", "name email phone")
      .select("-password")
      .lean();

    res.status(200).json({ success: true, count: agents.length, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};