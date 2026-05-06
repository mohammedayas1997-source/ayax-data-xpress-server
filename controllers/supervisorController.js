const User = require("../models/User");
const Sale = require("../models/Sale");
const mongoose = require("mongoose");

// 1. Ganin Agents na Supervisor (getMyAgents)
exports.getMyAgents = async (req, res) => {
  try {
    const agents = await User.find({
      assignedSupervisor: req.user._id,
      role: "agent",
    }).select("firstName surname phone email targets");

    res.status(200).json({ success: true, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 2. Ganin yadda kowane Agent yake kokari (getAgentSalesSummary)
exports.getAgentSalesSummary = async (req, res) => {
  try {
    const { agentId } = req.params;

    const stats = await Sale.aggregate([
      { $match: { agentId: new mongoose.Types.ObjectId(agentId) } },
      {
        $group: {
          _id: null,
          totalGB: { $sum: "$dataAmountGB" },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const performance =
      stats.length > 0 ? stats[0] : { totalGB: 0, totalAmount: 0 };
    res.status(200).json({ success: true, data: performance });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 3. Ba Agent Target (assignTargetToAgent)
exports.assignTargetToAgent = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { dataGoal } = req.body;

    const agent = await User.findOneAndUpdate(
      { _id: agentId, role: "agent", assignedSupervisor: req.user._id },
      {
        $set: {
          "targets.dataGoal": dataGoal,
          "targets.currentMonth": new Date().toLocaleString("default", {
            month: "long",
          }),
        },
      },
      { new: true },
    );

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found or not assigned to you",
      });
    }

    res.status(200).json({
      success: true,
      message: "Target assigned successfully",
      targets: agent.targets,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Leader Dashboard (Wanda ka turo - na bar shi don kariya)
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
      allTeamSales.map((item) => [String(item._id), item.teamGB]),
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
      }),
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
    res.status(500).json({ success: false, message: error.message });
  }
};
