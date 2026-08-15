const User = require("../models/User");
const Sale = require("../models/Sale");
const Activity = require("../models/Activity");
const mongoose = require("mongoose");

/**
 * @desc    Get Agents assigned to the logged-in Supervisor
 * @route   GET /api/v1/supervisor/agents
 * @access  Private (Supervisor)
 */
exports.getMyAgents = async (req, res) => {
  try {
    const agents = await User.find({
      assignedSupervisor: req.user._id,
      role: "agent",
    })
      .select("surname firstName phone email targets state lga")
      .lean();

    res.status(200).json({ 
      success: true, 
      count: agents.length,
      data: agents 
    });
  } catch (error) {
    console.error("Get My Agents Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get Sales Summary for a specific Agent
 * @route   GET /api/v1/supervisor/agent-sales/:agentId
 * @access  Private (Supervisor/Admin)
 */
exports.getAgentSalesSummary = async (req, res) => {
  try {
    const { agentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ success: false, message: "Invalid Agent ID format" });
    }

    const stats = await Sale.aggregate([
      { $match: { agentId: new mongoose.Types.ObjectId(agentId) } },
      {
        $group: {
          _id: null,
          totalGB: { $sum: "$dataAmountGB" },
          totalAmount: { $sum: "$amount" },
          totalSalesCount: { $sum: 1 },
        },
      },
    ]);

    const performance =
      stats.length > 0 ? stats[0] : { totalGB: 0, totalAmount: 0, totalSalesCount: 0 };

    res.status(200).json({ success: true, data: performance });
  } catch (error) {
    console.error("Get Agent Sales Summary Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Assign Target to an Agent under Supervisor
 * @route   PATCH /api/v1/supervisor/assign-target/:agentId
 * @access  Private (Supervisor)
 */
exports.assignTargetToAgent = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { dataGoal } = req.body;

    if (dataGoal === undefined || dataGoal === null) {
      return res.status(400).json({ success: false, message: "Please provide dataGoal target" });
    }

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ success: false, message: "Invalid Agent ID format" });
    }

    const currentMonthName = new Date().toLocaleString("default", { month: "long" });

    const agent = await User.findOneAndUpdate(
      { _id: agentId, role: "agent", assignedSupervisor: req.user._id },
      {
        $set: {
          "targets.dataGoal": Number(dataGoal),
          "targets.currentMonth": currentMonthName,
        },
      },
      { new: true, runValidators: true }
    ).select("surname firstName email targets");

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found or not assigned to you",
      });
    }

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "ASSIGN_AGENT_TARGET",
      details: `Assigned target of ${dataGoal}GB for ${currentMonthName} to agent ${agent.surname} ${agent.firstName}`,
      targetUser: agentId,
    });

    res.status(200).json({
      success: true,
      message: "Target assigned successfully",
      targets: agent.targets,
    });
  } catch (error) {
    console.error("Assign Target Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get Overall Leader / Admin Dashboard Statistics
 * @route   GET /api/v1/admin/leader-dashboard
 * @access  Private (Admin / Superadmin)
 */
exports.getLeaderDashboard = async (req, res) => {
  try {
    const supervisors = await User.find({ role: "supervisor" })
      .select("surname firstName phone email targets")
      .lean();

    const networkSales = await Sale.aggregate([
      { $group: { _id: null, overallGB: { $sum: "$dataAmountGB" } } },
    ]);

    const overallGB = networkSales.length > 0 ? networkSales[0].overallGB : 0;
    const totalAgentsCount = await User.countDocuments({ role: "agent" });

    const allTeamSales = await Sale.aggregate([
      { $group: { _id: "$supervisorId", teamGB: { $sum: "$dataAmountGB" } } },
    ]);

    const salesMap = new Map(
      allTeamSales.map((item) => [String(item._id), item.teamGB])
    );

    const supervisorDetails = await Promise.all(
      supervisors.map(async (sup) => {
        const myAgentsCount = await User.countDocuments({
          assignedSupervisor: sup._id,
          role: "agent",
        });
        return {
          id: sup._id,
          name: `${sup.surname || ""} ${sup.firstName || ""}`.trim(),
          phone: sup.phone,
          teamSize: myAgentsCount,
          teamPerformance: salesMap.get(String(sup._id)) || 0,
          targetAmount: sup.targets?.dataGoal || 0,
        };
      })
    );

    res.status(200).json({
      success: true,
      networkStats: {
        totalSupervisors: supervisors.length,
        totalAgents: totalAgentsCount,
        overallDataSold: overallGB,
        month: new Date().toLocaleString("default", {
          month: "long",
          year: "numeric",
        }),
      },
      supervisors: supervisorDetails,
    });
  } catch (error) {
    console.error("Get Leader Dashboard Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};