const User = require("../models/User");
const Activity = require("../models/Activity");
const mongoose = require("mongoose");

let Sale;
try {
  Sale = require("../models/Sale");
} catch (e) {
  Sale = null;
}

let Transaction;
try {
  Transaction = require("../models/Transaction");
} catch (e) {
  Transaction = null;
}

/**
 * @desc    Get Supervisor Profile, Assigned Target (Data & Airtime), & Agents Matrix
 * @route   GET /api/v1/supervisor/profile
 * @access  Private (Field Supervisor)
 */
exports.getSupervisorProfile = async (req, res) => {
  try {
    const supervisorId = req.user._id;

    const supervisor = await User.findById(supervisorId)
      .select("-password")
      .lean();

    if (!supervisor) {
      return res.status(404).json({ success: false, message: "Supervisor not found" });
    }

    // 1. Nemo Agents karkashin wannan Supervisor din (ta assignedSupervisor ko LGA matching)
    const agents = await User.find({
      role: "agent",
      $or: [
        { assignedSupervisor: supervisor._id },
        { lga: supervisor.lga, state: supervisor.state },
      ],
    })
      .select("firstName surname name phone email walletBalance balance targets state lga isSuspended createdAt")
      .lean();

    let totalTeamDataSold = 0;
    let totalTeamAirtimeSold = 0;

    // 2. Lissafa tallace-tallace na kowane agent
    const formattedAgents = await Promise.all(
      agents.map(async (ag) => {
        let agentDataSold = 0;
        let agentAirtimeSold = 0;

        try {
          if (Transaction) {
            // Data Sales
            const dataAgg = await Transaction.aggregate([
              {
                $match: {
                  user: ag._id,
                  status: { $in: ["successful", "success", "completed"] },
                  type: { $in: ["data", "DATA"] },
                },
              },
              {
                $group: {
                  _id: null,
                  totalVolume: { $sum: { $ifNull: ["$dataSize", "$volume", "$amount"] } },
                },
              },
            ]);
            agentDataSold = dataAgg[0]?.totalVolume || 0;

            // Airtime Sales
            const airtimeAgg = await Transaction.aggregate([
              {
                $match: {
                  user: ag._id,
                  status: { $in: ["successful", "success", "completed"] },
                  type: { $in: ["airtime", "AIRTIME", "vtu", "VTU"] },
                },
              },
              {
                $group: {
                  _id: null,
                  totalAmount: { $sum: "$amount" },
                },
              },
            ]);
            agentAirtimeSold = airtimeAgg[0]?.totalAmount || 0;
          } else if (Sale) {
            const saleStats = await Sale.aggregate([
              { $match: { agentId: ag._id } },
              {
                $group: {
                  _id: null,
                  totalGB: { $sum: "$dataAmountGB" },
                  totalAmount: { $sum: "$amount" },
                },
              },
            ]);
            agentDataSold = saleStats[0]?.totalGB || 0;
            agentAirtimeSold = saleStats[0]?.totalAmount || 0;
          }
        } catch (e) {
          agentDataSold = 0;
          agentAirtimeSold = 0;
        }

        totalTeamDataSold += agentDataSold;
        totalTeamAirtimeSold += agentAirtimeSold;

        const tg = ag.targets || {};

        return {
          _id: ag._id,
          id: ag._id,
          name: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim() || "Retail Agent",
          firstName: ag.firstName,
          surname: ag.surname,
          phone: ag.phone,
          email: ag.email,
          walletBalance: ag.walletBalance || ag.balance || 0,
          balance: ag.balance || ag.walletBalance || 0,
          state: ag.state || supervisor.state,
          lga: ag.lga || supervisor.lga,
          isSuspended: ag.isSuspended || false,
          dataSold: agentDataSold,
          totalGB: agentDataSold,
          todayGB: `${agentDataSold}GB`,
          airtimeSold: agentAirtimeSold,
          targets: {
            dataGoal: tg.dataGoal || 100,
            airtimeGoal: tg.airtimeGoal || 10000,
            currentMonth: tg.currentMonth || "August 2026",
          },
        };
      })
    );

    const supTargets = supervisor.targets || {};

    const supervisorPayload = {
      _id: supervisor._id,
      id: supervisor._id,
      name: supervisor.name || `${supervisor.firstName || ""} ${supervisor.surname || ""}`.trim(),
      firstName: supervisor.firstName,
      surname: supervisor.surname,
      phone: supervisor.phone,
      email: supervisor.email,
      state: supervisor.state || "Kano",
      lga: supervisor.lga || "Central",
      referralId: supervisor.referralId || `AX${String(supervisor.phone || "").slice(-4)}`,
      walletBalance: supervisor.walletBalance || supervisor.balance || 0,
      agentsCount: formattedAgents.length,
      teamPerformance: totalTeamDataSold,
      dataSold: totalTeamDataSold,
      airtimeSold: totalTeamAirtimeSold,
      targets: {
        dataGoal: supTargets.dataGoal || 500,
        airtimeGoal: supTargets.airtimeGoal || 50000,
        agentGoal: supTargets.agentGoal || 10,
        totalAgentsTarget: supTargets.agentGoal || 10,
        gbTarget: supTargets.dataGoal || 500,
        gbSold: totalTeamDataSold,
        dataSold: totalTeamDataSold,
        airtimeSold: totalTeamAirtimeSold,
        currentMonth: supTargets.currentMonth || "August 2026",
      },
      agents: formattedAgents,
    };

    res.status(200).json({
      success: true,
      status: "success",
      data: supervisorPayload,
      supervisor: supervisorPayload,
    });
  } catch (error) {
    console.error("Get Supervisor Profile Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get Agents assigned to the logged-in Supervisor (used in AgentManagementScreen)
 * @route   GET /api/v1/supervisor/my-agents
 * @access  Private (Supervisor)
 */
exports.getMyAgents = async (req, res) => {
  try {
    const supervisorId = req.user._id;
    const supervisor = await User.findById(supervisorId).lean();

    const agents = await User.find({
      role: "agent",
      $or: [
        { assignedSupervisor: supervisorId },
        ...(supervisor?.lga ? [{ lga: supervisor.lga, state: supervisor.state }] : []),
      ],
    })
      .select("-password")
      .lean();

    let totalData = 0;
    let totalAirtime = 0;

    const formattedAgents = await Promise.all(
      agents.map(async (ag) => {
        let agentDataSold = 0;
        let agentAirtimeSold = 0;

        try {
          if (Transaction) {
            const dataAgg = await Transaction.aggregate([
              {
                $match: {
                  user: ag._id,
                  status: { $in: ["successful", "success", "completed"] },
                  type: { $in: ["data", "DATA"] },
                },
              },
              {
                $group: {
                  _id: null,
                  totalVolume: { $sum: { $ifNull: ["$dataSize", "$volume", "$amount"] } },
                },
              },
            ]);
            agentDataSold = dataAgg[0]?.totalVolume || 0;

            const airtimeAgg = await Transaction.aggregate([
              {
                $match: {
                  user: ag._id,
                  status: { $in: ["successful", "success", "completed"] },
                  type: { $in: ["airtime", "AIRTIME", "vtu", "VTU"] },
                },
              },
              {
                $group: {
                  _id: null,
                  totalAmount: { $sum: "$amount" },
                },
              },
            ]);
            agentAirtimeSold = airtimeAgg[0]?.totalAmount || 0;
          }
        } catch (e) {
          agentDataSold = 0;
          agentAirtimeSold = 0;
        }

        totalData += agentDataSold;
        totalAirtime += agentAirtimeSold;

        const tg = ag.targets || {};

        return {
          _id: ag._id,
          id: ag._id,
          name: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim() || "Retail Agent",
          fullName: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim(),
          phone: ag.phone,
          email: ag.email,
          walletBalance: ag.walletBalance || ag.balance || 0,
          balance: ag.balance || ag.walletBalance || 0,
          state: ag.state || supervisor?.state,
          lga: ag.lga || supervisor?.lga,
          isSuspended: ag.isSuspended || false,
          dataSold: agentDataSold,
          todaySales: agentDataSold,
          totalGB: agentDataSold,
          airtimeSold: agentAirtimeSold,
          targets: {
            dataGoal: tg.dataGoal || 100,
            airtimeGoal: tg.airtimeGoal || 10000,
            currentMonth: tg.currentMonth || "August 2026",
          },
        };
      })
    );

    const supTargets = supervisor?.targets || {};

    res.status(200).json({
      success: true,
      count: formattedAgents.length,
      agents: formattedAgents,
      data: formattedAgents,
      stats: {
        totalRegistered: formattedAgents.length,
        totalDataSold: totalData,
        totalAirtimeSold: totalAirtime,
        monthlyGoal: supTargets.agentGoal || 10,
        dataGoal: supTargets.dataGoal || 500,
        airtimeGoal: supTargets.airtimeGoal || 50000,
      },
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

    let totalGB = 0;
    let totalAirtime = 0;
    let totalSalesCount = 0;

    if (Transaction) {
      const stats = await Transaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(agentId),
            status: { $in: ["successful", "success", "completed"] },
          },
        },
        {
          $group: {
            _id: "$type",
            totalVolume: { $sum: { $ifNull: ["$dataSize", "$volume", 0] } },
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]);

      stats.forEach((st) => {
        totalSalesCount += st.count;
        if (st._id === "data" || st._id === "DATA") {
          totalGB += st.totalVolume || st.totalAmount;
        } else {
          totalAirtime += st.totalAmount;
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        totalGB,
        totalAirtime,
        totalAmount: totalAirtime,
        totalSalesCount,
      },
    });
  } catch (error) {
    console.error("Get Agent Sales Summary Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Assign / Update Data & Airtime Target to an Agent under Supervisor
 * @route   PATCH /api/v1/supervisor/assign-target/:agentId
 * @access  Private (Supervisor)
 */
exports.assignTargetToAgent = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { dataGoal, airtimeGoal, month } = req.body;

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ success: false, message: "Invalid Agent ID format" });
    }

    const currentMonthName = month || new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

    const agent = await User.findOneAndUpdate(
      { _id: agentId, role: "agent" },
      {
        $set: {
          "targets.dataGoal": Number(dataGoal) || 0,
          "targets.airtimeGoal": Number(airtimeGoal) || 0,
          "targets.currentMonth": currentMonthName,
        },
      },
      { new: true, runValidators: true }
    ).select("name firstName surname email phone targets");

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "ASSIGN_AGENT_TARGET",
      details: `Supervisor assigned target (${dataGoal || 0}GB Data & ₦${airtimeGoal || 0} Airtime) to Agent ${agent.name || agent.phone}`,
      targetUser: agent._id,
    });

    res.status(200).json({
      success: true,
      message: "Agent target quota updated successfully",
      targets: agent.targets,
    });
  } catch (error) {
    console.error("Assign Target Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};